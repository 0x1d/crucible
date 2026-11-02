defmodule AgentFn.Memory.Query do
  @moduledoc """
  Queries memory with a pattern or one MiniGraf Datalog query.

  Pattern form (pass `where` + `find`):
  - `where` — non-empty list of clauses; each clause is `%{"e", "a", "v"}`
    or a 3-element list `[e, a, v]`. Strings starting with `?` are variables.
    Attributes are the closed set from `memory.transact`.
  - `find` — variable names to return (`"name"` or `"?name"`); each must
    appear in `where`.
  - Returns `rows` as maps keyed by variable name.

      %{"where" => [["?e", "description", "?d"]], "find" => ["e", "d"]}

  Datalog form (pass `datalog`, not `where`): one `(query [...])` string,
  for rules, negation, aggregates. Attributes are keywords, entities are
  `:decision/x`. Returns `results` (rows) + `variables`.

      %{"datalog" => "(query [:find ?e ?d :where [?e :description ?d]])"}

  Both forms accept `as_of` (tx number or ISO time) and `valid_at`
  (ISO time or `"any"`; default now).
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.query(args)
end