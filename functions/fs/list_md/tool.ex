defmodule AgentFn.Fs.ListMd do
  @moduledoc """
  List a directory and render its entries as a markdown table.

  Args:
  - `path` (required) — directory to list
  - `columns` — optional ordered column names for `md.table`
  - `key` — optional list key for `md.table` (defaults to entries)
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, listing} <- AgentFn.Fs.List.run(args) do
      table_args =
        args
        |> Map.take(["columns", "key", :columns, :key])
        |> Map.merge(listing)

      AgentFn.Md.Table.run(table_args)
    end
  end
end