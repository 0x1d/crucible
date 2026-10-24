defmodule AgentFn.Tool do
  @moduledoc """
  Behaviour for tools invoked via `call-function`.

  Only modules named `AgentFn.<ToolName>` (matching the registry slug) should
  implement this callback. Shared helpers belong under `AgentLib.*` in
  `functions/lib/` and must not implement `run/1`.
  """

  @type args :: map()
  @type result :: {:ok, term()} | {:error, String.t()} | map()

  @callback run(args()) :: result()
end
