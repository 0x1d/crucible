defmodule AgentFn.Memory.Transact do
  @moduledoc "Asserts facts or MiniGraf rules into memory. Requires a reason. A new entity also requires a description."

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.transact(args)
end
