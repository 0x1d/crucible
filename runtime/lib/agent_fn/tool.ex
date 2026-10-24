defmodule AgentFn.Tool do
  @moduledoc """
  Behaviour for registry entry modules (`run/1`).

  - **Entry module** for slug `data.pipeline.run` → `AgentFn.Data.Pipeline.Run`
  - **Deep modules** in the same tree (e.g. `AgentFn.Data.Pipeline.Steps.Fetch`) hold logic;
    call them from `run/1`; use `AgentFn.Registry.call/2` only for dynamic slugs.
  - **Shared** non-tool code → `AgentLib.*` under `functions/lib/`.
  """

  @type args :: map()
  @type result :: {:ok, term()} | {:error, String.t()} | map()

  @callback run(args()) :: result()
end
