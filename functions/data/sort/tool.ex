defmodule AgentFn.Data.Sort do
  @moduledoc """
  Sort a list of maps by one field.

  Args:
  - `entries` / `rows` / `items` / `data` — list of maps
  - `by` or `field` (required)
  - `order` — `asc` (default) or `desc`
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    field = Map.get(args, "by") || Map.get(args, :by) || Map.get(args, "field") || Map.get(args, :field)
    order = Map.get(args, "order") || Map.get(args, :order) || "asc"

    with {:ok, rows, source} <- extract_rows(args),
         true <- is_binary(field) and field != "" || {:error, "by (or field) is required"},
         true <- order in ["asc", "desc", :asc, :desc] || {:error, "order must be asc or desc"} do
      order_s = to_string(order)

      sorted =
        Enum.sort_by(rows, fn row ->
          Map.get(row, field) || Map.get(row, safe_atom(field))
        end)

      sorted = if order_s == "desc", do: Enum.reverse(sorted), else: sorted

      {:ok,
       %{
         "entries" => sorted,
         "count" => length(sorted),
         "by" => field,
         "order" => order_s,
         "source" => source
       }}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp extract_rows(args) do
    data = Map.get(args, "data") || Map.get(args, :data) || args
    key = Map.get(args, "key") || Map.get(args, :key)

    cond do
      is_binary(key) and key != "" ->
        case Map.get(data, key) do
          rows when is_list(rows) -> validate_rows(rows, key)
          _ -> {:error, "key #{inspect(key)} is not a list"}
        end

      is_list(Map.get(args, "entries") || Map.get(args, :entries)) ->
        validate_rows(Map.get(args, "entries") || Map.get(args, :entries), "entries")

      is_list(Map.get(args, "rows") || Map.get(args, :rows)) ->
        validate_rows(Map.get(args, "rows") || Map.get(args, :rows), "rows")

      is_list(Map.get(args, "items") || Map.get(args, :items)) ->
        validate_rows(Map.get(args, "items") || Map.get(args, :items), "items")

      is_map(data) ->
        Enum.find_value(["entries", "rows", "items"], fn k ->
          case Map.get(data, k) do
            rows when is_list(rows) -> validate_rows(rows, k)
            _ -> nil
          end
        end) || {:error, "no list of maps found (entries/rows/items)"}

      true ->
        {:error, "no list of maps found (entries/rows/items)"}
    end
  end

  defp validate_rows(rows, source) do
    if Enum.all?(rows, &is_map/1), do: {:ok, rows, source}, else: {:error, "#{source} must be a list of maps"}
  end

  defp safe_atom(k) when is_binary(k) do
    String.to_existing_atom(k)
  rescue
    ArgumentError -> nil
  end
end