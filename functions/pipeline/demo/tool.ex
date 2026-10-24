defmodule AgentFn.Pipeline.Demo do
  @moduledoc """
  Example flow: local step module, then direct `AgentFn.Echo.run/1`.
  Slug: `pipeline.demo`
  """

  @behaviour AgentFn.Tool

  alias AgentFn.Echo
  alias AgentFn.Pipeline.Demo.Steps.Enrich

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    enriched = Enrich.apply(args)

    case Echo.run(enriched) do
      {:ok, echoed} -> {:ok, Map.put(echoed, "composed", true)}
      {:error, message} -> {:error, message}
    end
  end
end
