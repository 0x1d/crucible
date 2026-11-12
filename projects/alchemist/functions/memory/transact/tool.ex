defmodule AgentFn.Memory.Transact do
  @moduledoc """
  Asserts facts or MiniGraf rules into memory. Requires a reason. A new entity also requires a description.

  Args:
  - `reason` (required) — why this is being written.
  - `facts` — list of `%{"e" => entity, "a" => attribute, "v" => string}`
    (objects, not tuples). Optional `valid_from` / `valid_to` ISO timestamps.
  - `rules` — optional list of `(rule [...])` strings.

  Schema (closed; anything else is rejected), aligned with the
  temporal_reasoning SKILL.md conventions:
  - `e`: `<prefix>/<slug>`, prefix one of `decision`, `preference`,
    `constraint`, `dependency`. Ids are canonicalized: lowercased, `_` and `-`
    kept, every other character becomes `-`, leading/trailing `-` stripped
    (`decision/Redis Cache` → `decision/redis-cache`). The result lists the
    canonical ids under `entities`.
  - `a`: one of `description`, `rationale`, `source-session` (string values)
    or the edges `depends-on`, `motivated-by`, `governs`, `supersedes`
    (value must be another entity id, canonicalized the same way).
  - Every entity automatically gets `ident` (its id) and `entity-type`
    (`type/<prefix>`). Both are queryable but cannot be written.
  - New entities need a `description` fact in the same call.
  - Put free-form detail (language, owner, ...) in `description` or `rationale`.

  Example:
      %{"reason" => "seed", "facts" => [
        %{"e" => "decision/db", "a" => "description", "v" => "Use PostgreSQL"},
        %{"e" => "decision/db", "a" => "rationale", "v" => "Team knows it"},
        %{"e" => "decision/db", "a" => "depends-on", "v" => "dependency/pg"},
        %{"e" => "dependency/pg", "a" => "description", "v" => "PostgreSQL 16"}
      ]}
  """

  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:facts) => [map()],
    required(:reason) => String.t(),
    optional(:rules) => [String.t()]
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.transact(args)
end