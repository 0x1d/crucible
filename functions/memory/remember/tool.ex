defmodule AgentFn.Memory.Remember do
  @moduledoc """
  Asserts many facts in one call.

  Same contract as `memory.transact`.
  Prefer this slug when persisting a bundle of related facts from chat.
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: AgentFn.Memory.Transact.run(args)
end
