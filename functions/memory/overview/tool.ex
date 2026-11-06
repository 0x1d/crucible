defmodule AgentFn.Memory.Overview do
  @moduledoc """
  Lists current memory entity ids (catalog only; no descriptions).

  Load full text with `memory.query`. Optional `prefix`, `limit`, `as_of`, and `valid_at`.
  """

  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:as_of) => String.t() | non_neg_integer(),
    optional(:limit) => non_neg_integer(),
    optional(:prefix) => String.t(),
    optional(:valid_at) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.overview(args)
end
