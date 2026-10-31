defmodule AgentFn.Memory.Query do
  @moduledoc """
  Queries the belief graph by pattern, transaction time, and valid time.
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.query(args)
end
