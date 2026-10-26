defmodule AgentFn.Echo do
  @moduledoc """
  Example codex entry. Returns the input args map with `"echoed" => true`.
  """

  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()}
  def run(args) when is_map(args) do
    {:ok, Map.put(args, "echoed", true)}
  end
end
