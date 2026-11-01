defmodule AgentFn.Memory.Recall do
  @moduledoc """
  Ranks current entities by token overlap with a question.
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: Runtime.Memory.recall(args)
end
