defmodule AgentFn.Pipeline.Demo do
  @moduledoc """
  Composed tool: enriches locally, then calls `echo` via `AgentFn.Registry`.
  Slug: `pipeline.demo`
  """

  @behaviour AgentFn.Tool

  alias AgentFn.Pipeline.Demo.Steps.Enrich
  alias AgentFn.Registry

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    enriched = Enrich.apply(args)

    case Registry.call("echo", enriched) do
      {:ok, echoed} -> {:ok, Map.put(echoed, "composed", true)}
      {:error, message} -> {:error, message}
    end
  end
end
