defmodule AgentFn.Memory.Retract do
  @moduledoc "Retracts facts from memory. The earlier assert remains visible at an earlier as_of."

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.retract(args)
end
