defmodule AgentFn.Codex.Docs do
  @moduledoc """
  Render a markdown catalog of available codex entries and their documentation.

  Includes an index table with `specs`, plus per-entry moduledoc and specs.

  Optional args:
  - `query` — case-insensitive substring filter on name/description/moduledoc/specs
  - `title` — document title (default "Codex entries")
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:query) => String.t(),
    optional(:title) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    query = Map.get(args, "query") || Map.get(args, :query)
    title = Map.get(args, "title") || Map.get(args, :title) || "Codex entries"

    entries =
      AgentFn.Codex.list()
      |> Enum.map(&normalize/1)
      |> Enum.filter(&matches?(&1, query))
      |> Enum.sort_by(& &1["name"])

    summary_rows =
      Enum.map(entries, fn e ->
        %{
          "name" => e["name"],
          "module" => e["module"],
          "loaded" => e["loaded"],
          "specs" => format_specs_inline(e["specs"]),
          "summary" => first_line(e["moduledoc"] || e["description"] || "")
        }
      end)

    with {:ok, h1} <- AgentFn.Md.Heading.run(%{"text" => title, "level" => 1}),
         {:ok, h2_index} <-
           AgentFn.Md.Heading.run(%{
             "text" => "Index (#{length(entries)})",
             "level" => 2
           }),
         {:ok, index_table} <-
           AgentFn.Md.Table.run(%{
             "entries" => summary_rows,
             "columns" => ["name", "module", "loaded", "specs", "summary"]
           }),
         {:ok, h2_docs} <- AgentFn.Md.Heading.run(%{"text" => "Documentation", "level" => 2}),
         detail_parts <- Enum.map(entries, &detail_section/1),
         {:ok, doc} <-
           AgentFn.Md.Concat.run(%{
             "parts" => [h1, h2_index, index_table, h2_docs | detail_parts]
           }) do
      {:ok,
       %{
         "markdown" => doc["markdown"],
         "count" => length(entries),
         "entries" => Enum.map(entries, & &1["name"])
       }}
    end
  end

  defp normalize(entry) when is_map(entry) do
    %{
      "name" => to_string(Map.get(entry, "name") || Map.get(entry, :name) || ""),
      "module" => to_string(Map.get(entry, "module") || Map.get(entry, :module) || ""),
      "description" => Map.get(entry, "description") || Map.get(entry, :description),
      "moduledoc" => Map.get(entry, "moduledoc") || Map.get(entry, :moduledoc),
      "specs" => normalize_specs(Map.get(entry, "specs") || Map.get(entry, :specs)),
      "loaded" => Map.get(entry, "loaded") || Map.get(entry, :loaded),
      "updated_at" => Map.get(entry, "updated_at") || Map.get(entry, :updated_at)
    }
  end

  defp normalize_specs(nil), do: []
  defp normalize_specs(list) when is_list(list), do: Enum.map(list, &to_string/1)
  defp normalize_specs(other), do: [to_string(other)]

  defp format_specs_inline([]), do: ""
  defp format_specs_inline(specs), do: Enum.join(specs, "; ")

  defp matches?(_entry, query) when not is_binary(query) or query == "", do: true

  defp matches?(entry, query) do
    q = String.downcase(query)

    haystack =
      [
        entry["name"],
        entry["module"],
        entry["description"],
        entry["moduledoc"],
        format_specs_inline(entry["specs"])
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join(" ")
      |> String.downcase()

    String.contains?(haystack, q)
  end

  defp detail_section(entry) do
    specs_block =
      case entry["specs"] do
        [] ->
          "_(no specs)_"

        list ->
          body = Enum.join(list, "\n")

          case AgentFn.Md.Code.run(%{"content" => body, "lang" => "elixir"}) do
            {:ok, %{"markdown" => md}} -> md
            _ -> Enum.map_join(list, "\n", fn s -> "- `#{s}`" end)
          end
      end

    doc = String.trim(entry["moduledoc"] || entry["description"] || "_(no documentation)_")

    meta =
      [
        "- **module:** `#{entry["module"]}`",
        "- **loaded:** #{inspect(entry["loaded"])}",
        if(entry["updated_at"], do: "- **updated:** #{entry["updated_at"]}", else: nil)
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("\n")

    """
    ### `#{entry["name"]}`

    #{meta}

    #### Specs

    #{specs_block}

    #### Moduledoc

    #{doc}
    """
  end

  defp first_line(text) when is_binary(text) do
    text
    |> String.split("\n", parts: 2)
    |> hd()
    |> String.trim()
    |> String.slice(0, 120)
  end

  defp first_line(_), do: ""
end