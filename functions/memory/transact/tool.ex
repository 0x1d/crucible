defmodule AgentFn.Memory.Transact do
  @moduledoc """
  Asserts facts or MiniGraf rules into memory. Requires a reason. A new entity also requires a description.

  Args:
  - `reason` (required) — why this is being written.
  - `facts` — list of `%{"e" => entity, "a" => attribute, "v" => string}`
    (objects, not tuples). Optional `valid_from` / `valid_to` ISO timestamps.
  - `rules` — optional list of `(rule [...])` strings.

  Schema (closed; anything else is rejected):
  - `e`: `<prefix>/<slug>`, prefix one of `decision`, `preference`,
    `constraint`, `dependency`; slug `[a-z0-9][a-z0-9_-]*`.
  - `a`: one of `description`, `rationale`, `source_session` (string values)
    or the edges `depends_on`, `motivated_by`, `governs`, `supersedes`
    (value must be another entity id).
  - New entities need a `description` fact in the same call.
  - Put free-form detail (language, owner, ...) in `description` or `rationale`.

  Example:
      %{"reason" => "seed", "facts" => [
        %{"e" => "decision/db", "a" => "description", "v" => "Use PostgreSQL"},
        %{"e" => "decision/db", "a" => "rationale", "v" => "Team knows it"},
        %{"e" => "decision/db", "a" => "depends_on", "v" => "dependency/pg"},
        %{"e" => "dependency/pg", "a" => "description", "v" => "PostgreSQL 16"}
      ]}
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.transact(args)
end