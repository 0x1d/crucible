defmodule AgentFn.Data.Select do
  @moduledoc """
  Project keys from a list of maps.

  Args:
  - `entries`, `rows`, `items`, or nested under `data` — list of maps
  - `keys` or `columns` (required) — keys to keep (order preserved)
  - `rename` — optional map of `from => to` renames applied after select
  - `key` — optional list key when unwrapping `data`
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:columns) => [String.t()],
    optional(:data) => [map()],
    optional(:entries) => [map()],
    optional(:items) => [map()],
    optional(:key) => String.t(),
    optional(:keys) => [String.t()],
    optional(:rename) => map(),
    optional(:rows) => [map()]
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    keys = Map.get(args, "keys") || Map.get(args, :keys) || Map.get(args, "columns") || Map.get(args, :columns)
    rename = Map.get(args, "rename") || Map.get(args, :rename) || %{}

    with {:ok, rows, source} <- extract_rows(args),
         {:ok, key_list} <- normalize_keys(keys),
         {:ok, rename_map} <- normalize_rename(rename) do
      selected =
        Enum.map(rows, fn row ->
          key_list
          |> Enum.reduce(%{}, fn k, acc ->
            val = Map.get(row, k)

            val =
              if is_nil(val) do
                Map.get(row, safe_atom(k))
              else
                val
              end

            Map.put(acc, k, val)
          end)
          |> rename_keys(rename_map)
        end)

      {:ok,
       %{
         "entries" => selected,
         "count" => length(selected),
         "keys" => Enum.map(key_list, &Map.get(rename_map, &1, &1)),
         "source" => source
       }}
    end
  end

  defp normalize_keys(keys) when is_list(keys) and keys != [] do
    {:ok, Enum.map(keys, &to_string/1)}
  end

  defp normalize_keys(_), do: {:error, "keys (or columns) must be a non-empty list"}

  defp normalize_rename(%{} = m) do
    {:ok, Map.new(m, fn {k, v} -> {to_string(k), to_string(v)} end)}
  end

  defp normalize_rename(_), do: {:error, "rename must be a map"}

  defp rename_keys(row, rename) when map_size(rename) == 0, do: row

  defp rename_keys(row, rename) do
    Enum.reduce(row, %{}, fn {k, v}, acc ->
      Map.put(acc, Map.get(rename, k, k), v)
    end)
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
    if Enum.all?(rows, &is_map/1) do
      {:ok, rows, source}
    else
      {:error, "#{source} must be a list of maps"}
    end
  end

  defp safe_atom(k) when is_binary(k) do
    String.to_existing_atom(k)
  rescue
    ArgumentError -> nil
  end

  defp safe_atom(_), do: nil
end