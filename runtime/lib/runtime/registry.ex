defmodule Runtime.Registry do
  @moduledoc false

  def functions_root do
    System.get_env("AGENT_FUNCTIONS_DIR") ||
      Path.expand("../functions", Path.dirname(__ENV__.file))
  end

  def function_dir(name) do
    Path.join(functions_root(), sanitize(name))
  end

  def meta_path(name), do: Path.join(function_dir(name), "meta.json")
  def source_path(name), do: Path.join(function_dir(name), "tool.ex")

  def sanitize(name) when is_binary(name) do
    slug =
      name
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9_]+/u, "_")
      |> String.trim("_")

    if slug == "" do
      raise ArgumentError, "invalid function name"
    end

    slug
  end

  def module_name(name) do
    segment =
      sanitize(name)
      |> String.split("_")
      |> Enum.map(&Macro.camelize/1)
      |> Enum.join()

    Module.concat([AgentFn, segment])
  end

  def list_all do
    root = functions_root()

    if File.dir?(root) do
      root
      |> File.ls!()
      |> Enum.filter(fn entry ->
        path = Path.join(root, entry)
        File.dir?(path) and File.exists?(Path.join(path, "meta.json"))
      end)
      |> Enum.map(&load_meta/1)
      |> Enum.sort_by(& &1["name"])
    else
      []
    end
  end

  def load_meta(name) do
    path = meta_path(sanitize(name))

    case File.read(path) do
      {:ok, body} -> Jason.decode!(body)
      {:error, _} -> %{"name" => sanitize(name), "loaded" => false}
    end
  end

  def write_definition(name, source, description \\ nil) do
    slug = sanitize(name)
    dir = function_dir(slug)
    File.mkdir_p!(dir)

    module = module_name(slug)
    full_source = ensure_module(module, source)

    File.write!(source_path(slug), full_source)

    meta = %{
      "name" => slug,
      "module" => Atom.to_string(module),
      "description" => description,
      "updated_at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "loaded" => false
    }

    File.write!(meta_path(slug), Jason.encode!(meta, pretty: true))
    {:ok, meta}
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
      trimmed
    else
      """
      defmodule #{inspect(module)} do
        @moduledoc false

      #{indent(trimmed, 2)}
      end
      """
      |> String.trim_trailing()
      |> Kernel.<>("\n")
    end
  end

  defp indent(text, spaces) do
    pad = String.duplicate(" ", spaces)

    text
    |> String.split("\n")
    |> Enum.map_join("\n", fn line -> pad <> line end)
  end
end
