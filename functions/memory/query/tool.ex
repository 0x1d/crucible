defmodule AgentFn.Memory.Query do
  @moduledoc "Queries memory with a pattern or one MiniGraf Datalog query."

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.query(args)
end
