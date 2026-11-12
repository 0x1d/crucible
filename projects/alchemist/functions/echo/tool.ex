defmodule AgentFn.Echo do
  @moduledoc """
  Example codex entry. Returns the input args map with `"echoed" => true`.
  """

  @behaviour AgentFn.Tool
  @type args :: %{optional(String.t()) => term()}

  @spec run(args()) :: {:ok, map()}
  def run(args) when is_map(args) do
    {:ok, Map.put(args, "echoed", true)}
  end
end
