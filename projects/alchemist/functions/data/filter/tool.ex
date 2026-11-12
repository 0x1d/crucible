defmodule AgentFn.Data.Filter do
  @moduledoc """
  Filter a list of maps by field predicates.

  Args:
  - `entries` / `rows` / `items` / `data` — list of maps
  - Single predicate: `field`, `op`, `value`
  - Or `filters` — list of `%{field, op, value}` (AND)

  Ops: `eq`, `neq`, `contains`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:data) => [map()],
    optional(:entries) => [map()],
    optional(:field) => String.t(),
    optional(:filters) => [map()],
    optional(:items) => [map()],
    optional(:key) => String.t(),
    optional(:op) => String.t(),
    optional(:rows) => [map()],
    optional(:value) => term()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, rows, source} <- extract_rows(args),
         {:ok, filters} <- build_filters(args) do
      kept = Enum.filter(rows, &match_all?(&1, filters))

      {:ok,
       %{
         "entries" => kept,
         "count" => length(kept),
         "input_count" => length(rows),
         "source" => source,
         "filters" => Enum.map(filters, &stringify_filter/1)
       }}
    end
  end

  defp build_filters(args) do
    case Map.get(args, "filters") || Map.get(args, :filters) do
      list when is_list(list) and list != [] ->
        list
        |> Enum.reduce_while({:ok, []}, fn f, {:ok, acc} ->
          case normalize_filter(f) do
            {:ok, filt} -> {:cont, {:ok, [filt | acc]}}
            {:error, _} = err -> {:halt, err}
          end
        end)
        |> case do
          {:ok, rev} -> {:ok, Enum.reverse(rev)}
          err -> err
        end

      _ ->
        normalize_filter(%{
          "field" => Map.get(args, "field") || Map.get(args, :field),
          "op" => Map.get(args, "op") || Map.get(args, :op) || "eq",
          "value" => Map.get(args, "value") || Map.get(args, :value)
        })
        |> case do
          {:ok, f} -> {:ok, [f]}
          err -> err
        end
    end
  end

  defp normalize_filter(%{} = f) do
    field = Map.get(f, "field") || Map.get(f, :field)
    op = Map.get(f, "op") || Map.get(f, :op) || "eq"
    value = Map.get(f, "value") || Map.get(f, :value)

    cond do
      not is_binary(field) or field == "" ->
        {:error, "filter field is required"}

      op not in ~w(eq neq contains gt gte lt lte in exists) ->
        {:error, "unsupported op: #{inspect(op)}"}

      true ->
        {:ok, {field, to_string(op), value}}
    end
  end

  defp normalize_filter(_), do: {:error, "filter must be a map"}

  defp match_all?(row, filters), do: Enum.all?(filters, &match_one?(row, &1))

  defp match_one?(row, {field, op, expected}) do
    actual = Map.get(row, field) || Map.get(row, safe_atom(field))

    case op do
      "exists" -> not is_nil(actual)
      "eq" -> actual == expected or to_string(actual) == to_string(expected)
      "neq" -> not (actual == expected or to_string(actual) == to_string(expected))
      "contains" -> is_binary(actual) and is_binary(expected) and String.contains?(actual, expected)
      "in" when is_list(expected) -> Enum.any?(expected, &(actual == &1 or to_string(actual) == to_string(&1)))
      "gt" -> comparable?(actual, expected) and compare(actual, expected) == :gt
      "gte" -> comparable?(actual, expected) and compare(actual, expected) in [:gt, :eq]
      "lt" -> comparable?(actual, expected) and compare(actual, expected) == :lt
      "lte" -> comparable?(actual, expected) and compare(actual, expected) in [:lt, :eq]
      _ -> false
    end
  end

  defp comparable?(a, b) when is_number(a) and is_number(b), do: true
  defp comparable?(a, b) when is_binary(a) and is_binary(b), do: true
  defp comparable?(_, _), do: false

  defp compare(a, b) when is_number(a) and is_number(b) do
    cond do
      a > b -> :gt
      a < b -> :lt
      true -> :eq
    end
  end

  defp compare(a, b) when is_binary(a) and is_binary(b) do
    cond do
      a > b -> :gt
      a < b -> :lt
      true -> :eq
    end
  end

  defp stringify_filter({field, op, value}),
    do: %{"field" => field, "op" => op, "value" => value}

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

  defp safe_atom(_), do: nil
end