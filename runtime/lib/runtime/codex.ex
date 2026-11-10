defmodule Runtime.Codex do
  @moduledoc """
  Slug sanitization, filesystem layout, `meta.json` I/O, and capability-tree discovery.

  Decodes disk metadata with `Jason.decode/1` and falls back to a minimal record when
  files are missing or invalid.
  """

  # meta.json keys that `define` keeps: `service` holds a service's JSON Schemas
  # (see Runtime.ServiceGateway).
  @kept_meta_keys ["service"]

  def functions_root do
    System.get_env("AGENT_FUNCTIONS_DIR") ||
      Path.expand("../functions", Path.dirname(__ENV__.file))
  end

  def function_dir(name) do
    Path.join([functions_root() | slug_path_segments(name)])
  end

  def meta_path(name), do: Path.join(function_dir(name), "meta.json")
  def source_path(name), do: Path.join(function_dir(name), "tool.ex")

  @doc """
  Canonical slug: dot-separated segments, each `snake_case`.
  Examples: `echo`, `fetch_weather`, `data.pipeline.normalize`
  """
  def sanitize(name) when is_binary(name) do
    parts =
      name
      |> String.downcase()
      |> String.split(".")
      |> Enum.map(&segment_sanitize/1)
      |> Enum.reject(&(&1 == ""))

    case parts do
      [] -> raise ArgumentError, "invalid function name"
      _ -> Enum.join(parts, ".")
    end
  end

  def slug_path_segments(name) do
    sanitize(name) |> String.split(".")
  end

  def module_name(name) do
    parts =
      slug_path_segments(name)
      |> Enum.map(&segment_to_module_part/1)

    Module.concat([AgentFn | parts])
  end

  def list_all do
    root = functions_root()

    if File.dir?(root) do
      walk_for_tools(root, [])
      |> Enum.sort_by(& &1["name"])
    else
      []
    end
  end

  defp walk_for_tools(dir, rel_segments) do
    meta =
      if File.exists?(Path.join(dir, "meta.json")) do
        slug = Enum.join(rel_segments, ".")
        [load_meta(slug)]
      else
        []
      end

    children =
      case File.ls(dir) do
        {:ok, entries} ->
          Enum.flat_map(entries, fn entry ->
            if entry == "lib" and rel_segments == [] do
              []
            else
              child = Path.join(dir, entry)

              if File.dir?(child) do
                walk_for_tools(child, rel_segments ++ [entry])
              else
                []
              end
            end
          end)

        {:error, _} ->
          []
      end

    meta ++ children
  end

  def load_meta(name) do
    slug = sanitize(name)
    path = meta_path(slug)

    case File.read(path) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, meta} when is_map(meta) -> Map.put(meta, "name", slug)
          _ -> %{"name" => slug, "loaded" => false}
        end

      {:error, _} ->
        %{"name" => slug, "loaded" => false}
    end
  end

  def write_definition(name, source, description \\ nil) do
    slug = sanitize(name)
    dir = function_dir(slug)
    File.mkdir_p!(dir)

    module = module_name(slug)
    full_source = ensure_module(module, source)

    # `define` replaces the entry; keys owned by others (a service's schemas) carry over.
    kept = load_meta(slug) |> Map.take(@kept_meta_keys)

    File.write!(source_path(slug), full_source)

    meta =
      write_meta_file(
        slug,
        Map.merge(kept, %{
          "name" => slug,
          "module" => Atom.to_string(module),
          "description" => description,
          "source_sha256" => sha256_hex(full_source),
          "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
          "loaded" => false
        })
      )

    {:ok, meta}
  end

  @doc """
  Sync module docs/specs into `meta.json` after compile.

  `updated_at` advances only when `tool.ex` content changes (SHA-256).
  Seeding `source_sha256` on legacy meta does not count as a change.
  """
  def refresh_metadata!(slug, module) do
    docs = Runtime.Metadata.extract(module, slug)
    meta = load_meta(slug)
    source_sha = source_sha256(slug)

    description =
      case docs["moduledoc"] do
        doc when is_binary(doc) and doc != "" -> doc
        _ -> meta["description"]
      end

    updated =
      meta
      |> Map.put("module", Atom.to_string(module))
      |> Map.put("description", description)
      |> Map.put("moduledoc", docs["moduledoc"])
      |> Map.put("specs", docs["specs"])
      |> Map.put("source_sha256", source_sha)

    updated =
      cond do
        meta["source_sha256"] == source_sha ->
          updated

        is_binary(meta["source_sha256"]) and meta["source_sha256"] != "" ->
          Map.put(updated, "updated_at", DateTime.utc_now() |> DateTime.to_iso8601())

        true ->
          # Legacy meta without a hash: seed without treating compile as an edit.
          updated
      end

    if updated == meta do
      meta
    else
      write_meta_file(slug, updated)
    end
  end

  defp write_meta_file(slug, meta) do
    File.write!(meta_path(slug), Jason.encode!(meta, pretty: true))
    meta
  end

  def mark_loaded(name, loaded) do
    slug = sanitize(name)
    meta = load_meta(slug)

    if meta["loaded"] == loaded do
      meta
    else
      updated = Map.put(meta, "loaded", loaded)
      File.write!(meta_path(slug), Jason.encode!(updated, pretty: true))
      updated
    end
  end

  defp source_sha256(slug) do
    case File.read(source_path(slug)) do
      {:ok, body} -> sha256_hex(body)
      {:error, _} -> nil
    end
  end

  defp sha256_hex(body) when is_binary(body) do
    :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)
  end

  defp ensure_module(module, source) do
    trimmed = String.trim(source)

    if String.starts_with?(trimmed, "defmodule ") do
      unless String.contains?(trimmed, "defmodule #{inspect(module)}") do
        raise ArgumentError,
              "defmodule must be named #{inspect(module)} to match the codex slug"
      end

      trimmed
    else
      """
      defmodule #{inspect(module)} do
        @behaviour AgentFn.Tool

      #{indent(trimmed, 2)}
      end
      """
      |> String.trim_trailing()
      |> Kernel.<>("\n")
    end
  end

  defp segment_sanitize(part) do
    part
    |> String.replace(~r/[^a-z0-9_]+/u, "_")
    |> String.trim("_")
  end

  defp segment_to_module_part(segment) do
    segment
    |> String.split("_")
    |> Enum.map(&Macro.camelize/1)
    |> Enum.join()
  end

  defp indent(text, spaces) do
    pad = String.duplicate(" ", spaces)

    text
    |> String.split("\n")
    |> Enum.map_join("\n", fn line -> pad <> line end)
  end
end
