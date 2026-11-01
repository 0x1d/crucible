defmodule AgentFn.Memory.Overview do
  @moduledoc """
  Lists current memory entity ids (catalog only; no descriptions).

  Load full text with `memory.query`. Optional `prefix`, `limit`, `as_of`, and `valid_at`.
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.overview(args)
end
