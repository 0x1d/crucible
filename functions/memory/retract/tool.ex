defmodule AgentFn.Memory.Retract do
  @moduledoc "Retracts facts from the current belief graph. The earlier assert stays in the log and remains visible at an earlier as_of."

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.retract(args)
end
