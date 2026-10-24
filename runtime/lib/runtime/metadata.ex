defmodule Runtime.Metadata do
  @moduledoc false

  alias Runtime.Registry

  @spec extract(module(), String.t()) :: map()
  def extract(module, slug) when is_atom(module) and is_binary(slug) do
    path = Registry.source_path(slug)
    source = if File.exists?(path), do: File.read!(path), else: ""

    %{
      "moduledoc" => fetch_moduledoc(module, source),
      "specs" => fetch_specs(module, source)
    }
  end

  defp fetch_moduledoc(module, source) do
    from_docs =
      case Code.fetch_docs(module) do
        {:docs_v1, _, :elixir, _, doc, _, _} when is_binary(doc) -> String.trim(doc)
        _ -> nil
      end

    from_docs || moduledoc_from_source(source)
  end

  defp moduledoc_from_source(source) do
    case Regex.run(~r/@moduledoc\s+"""\s*(.*?)\s*"""/s, source) do
      [_, doc] ->
        String.trim(doc)

      _ ->
        case Regex.run(~r/@moduledoc\s+"([^"]*)"/, source) do
          [_, doc] -> String.trim(doc)
          _ -> nil
        end
    end
  end

  defp fetch_specs(_module, source) do
    Regex.scan(~r/@spec\s+.+$/m, source)
    |> Enum.map(fn [line] -> String.trim(line) end)
  end
end
