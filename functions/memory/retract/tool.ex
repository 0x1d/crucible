defmodule AgentFn.Memory.Retract do
  @moduledoc """
  Ends facts in memory (close, default) or withdraws facts recorded in error (correct).

  Args: `reason` (required), `facts` (list of `e`/`a`/`v`), optional `mode`, optional `valid_at`.

  - `mode: "close"` (default) — the fact stopped being true. Its live valid window
    ends at `valid_at` (default now; past or present only). `valid_at` queries inside
    the window still find it. Facts take `e`, `a`, `v` only.
  - `mode: "correct"` — the fact was never true. It is withdrawn across all valid
    time; only an earlier `as_of` still shows it. Takes no `valid_at`.
  """

  @behaviour AgentFn.Tool
  @type args :: %{
    required(:facts) => [map()],
    optional(:mode) => String.t(),
    required(:reason) => String.t(),
    optional(:valid_at) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.retract(args)
end