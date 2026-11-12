defmodule AgentFn.Md.Table do
  @moduledoc """
  Render a structured map as a markdown table.

  Pass any map (e.g. an `fs.list` result). Prefers a list of maps under
  `entries`, `rows`, or `items`, or under an optional `key`. Otherwise
  renders the map itself as a two-column key/value table.

  Optional args:
  - `data` — wrap the payload when mixing with other options
  - `key` — list key to use for rows
  - `columns` — ordered column names (defaults to sorted union of keys)
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:columns) => [String.t()],
    optional(:data) => [map()],
    optional(:key) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    data = unwrap_data(args)
    key = Map.get(args, "key") || Map.get(args, :key)
    columns_opt = Map.get(args, "columns") || Map.get(args, :columns)

    case extract_rows(data, key) do
      {:ok, rows, source} ->
        columns = resolve_columns(rows, columns_opt)
        markdown = to_markdown(columns, rows)

        {:ok,
         %{
           "markdown" => markdown,
           "columns" => columns,
           "row_count" => length(rows),
           "source" => source
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp unwrap_data(args) do
    case Map.get(args, "data") || Map.get(args, :data) do
      %{} = data -> data
      _ -> args
    end
  end

  defp extract_rows(data, key) when is_binary(key) and key != "" do
    case Map.get(data, key) do
      rows when is_list(rows) ->
        if Enum.all?(rows, &is_map/1) do
          {:ok, rows, key}
        else
          {:error, "key #{inspect(key)} is not a list of maps"}
        end

      nil ->
        {:error, "key #{inspect(key)} not found"}

      _ ->
        {:error, "key #{inspect(key)} is not a list"}
    end
  end

  defp extract_rows(data, _) do
    preferred = ["entries", "rows", "items"]

    Enum.find_value(preferred, fn k ->
      case Map.get(data, k) do
        rows when is_list(rows) and rows != [] ->
          if Enum.all?(rows, &is_map/1), do: {:ok, rows, k}, else: nil

        _ ->
          nil
      end
    end) ||
      find_list_of_maps(data) ||
      {:ok, kv_rows(data), "key_value"}
  end

  defp find_list_of_maps(data) do
    Enum.find_value(data, fn
      {k, rows} when is_list(rows) and rows != [] ->
        if Enum.all?(rows, &is_map/1), do: {:ok, rows, to_string(k)}, else: nil

      _ ->
        nil
    end)
  end

  defp kv_rows(data) do
    data
    |> Enum.reject(fn {k, _} -> k in ["data", "key", "columns", :data, :key, :columns] end)
    |> Enum.map(fn {k, v} ->
      %{"key" => to_string(k), "value" => stringify(v)}
    end)
    |> Enum.sort_by(& &1["key"])
  end

  defp resolve_columns(_rows, columns) when is_list(columns) and columns != [] do
    Enum.map(columns, &to_string/1)
  end

  defp resolve_columns(rows, _) do
    rows
    |> Enum.flat_map(&Map.keys/1)
    |> Enum.map(&to_string/1)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp to_markdown(_columns, []), do: "_(empty)_"

  defp to_markdown(columns, rows) do
    header = "| " <> Enum.map_join(columns, " | ", &escape/1) <> " |"
    sep = "| " <> Enum.map_join(columns, " | ", fn _ -> "---" end) <> " |"

    body =
      Enum.map_join(rows, "\n", fn row ->
        cells =
          Enum.map(columns, fn col ->
            row
            |> Map.get(col)
            |> Kernel.||(Map.get(row, String.to_atom(col)))
            |> stringify()
            |> escape()
          end)

        "| " <> Enum.join(cells, " | ") <> " |"
      end)

    Enum.join([header, sep, body], "\n")
  end

  defp stringify(nil), do: ""
  defp stringify(v) when is_binary(v), do: v
  defp stringify(v) when is_atom(v), do: Atom.to_string(v)
  defp stringify(v), do: inspect(v)

  defp escape(s) when is_binary(s) do
    s
    |> String.replace("|", "\\|")
    |> String.replace("\n", " ")
  end
end