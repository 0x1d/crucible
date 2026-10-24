defmodule AgentFn.Echo do
  @moduledoc false

  def run(args) when is_map(args) do
    {:ok, Map.put(args, "echoed", true)}
  end
end
