defmodule AgentFn.Demo.Report do
  @moduledoc """
  Demo pipeline: `fs.glob` → `data.filter` → `data.sort` → `md.table` → `md.concat`.

  Args:
  - `path` / `root` (required)
  - `pattern` (required)
  - `field`, `op`, `value` — optional filter (default: extension eq "ex")
  - `by` — sort field (default `path`)
  - `order` — `asc` or `desc`
  - `columns` — table columns
  - `title` — report heading text
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    title = Map.get(args, "title") || Map.get(args, :title) || "Codex report"
    by = Map.get(args, "by") || Map.get(args, :by) || "path"
    order = Map.get(args, "order") || Map.get(args, :order) || "asc"

    columns =
      Map.get(args, "columns") || Map.get(args, :columns) ||
        ["path", "type", "size", "extension", "modify_time"]

    field = Map.get(args, "field") || Map.get(args, :field) || "extension"
    op = Map.get(args, "op") || Map.get(args, :op) || "eq"
    value = Map.get(args, "value") || Map.get(args, :value) || "ex"

    with {:ok, listing} <- AgentFn.Fs.Glob.run(args),
         {:ok, filtered} <-
           AgentFn.Data.Filter.run(%{
             "entries" => listing["entries"],
             "field" => field,
             "op" => op,
             "value" => value
           }),
         {:ok, sorted} <-
           AgentFn.Data.Sort.run(%{
             "entries" => filtered["entries"],
             "by" => by,
             "order" => order
           }),
         {:ok, heading} <- AgentFn.Md.Heading.run(%{"text" => title, "level" => 1}),
         {:ok, summary} <-
           AgentFn.Md.Heading.run(%{
             "text" =>
               "#{filtered["count"]} of #{listing["count"]} matches" <>
                 " (`#{field} #{op} #{inspect(value)}`)",
             "level" => 2
           }),
         {:ok, table} <-
           AgentFn.Md.Table.run(%{
             "entries" => sorted["entries"],
             "columns" => columns
           }),
         {:ok, doc} <-
           AgentFn.Md.Concat.run(%{
             "parts" => [heading, summary, table]
           }) do
      {:ok,
       %{
         "markdown" => doc["markdown"],
         "root" => listing["root"],
         "pattern" => listing["pattern"],
         "matched" => filtered["count"],
         "total" => listing["count"]
       }}
    end
  end
end