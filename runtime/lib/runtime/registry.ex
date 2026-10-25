defmodule Runtime.Registry do
  @moduledoc false

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
        Jason.decode!(body) |> Map.put("name", slug)

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

    File.write!(source_path(slug), full_source)

    meta =
      write_meta_file(slug, %{
        "name" => slug,
        "module" => Atom.to_string(module),
        "description" => description,
        "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
        "loaded" => false
      })

    {:ok, meta}
  end

  def refresh_metadata!(slug, module) do
    docs = Runtime.Metadata.extract(module, slug)
    meta = load_meta(slug)

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
      |> Map.put("updated_at", DateTime.utc_now() |> DateTime.to_iso8601())

    write_meta_file(slug, updated)
  end

  defp write_meta_file(slug, meta) do
    File.write!(meta_path(slug), Jason.encode!(meta, pretty: true))
    meta
  end

  def mark_loaded(name, loaded) do
    slug = sanitize(name)
    meta = load_meta(slug)
    updated = Map.put(meta, "loaded", loaded)
    File.write!(meta_path(slug), Jason.encode!(updated, pretty: true))
    updated
  end

  defp ensure_module(module, source) do
    trimmed = String.trim(source)

    if String.starts_with?(trimmed, "defmodule ") do
      unless String.contains?(trimmed, "defmodule #{inspect(module)}") do
        raise ArgumentError,
              "defmodule must be named #{inspect(module)} to match the registry slug"
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
