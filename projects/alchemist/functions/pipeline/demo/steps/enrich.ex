defmodule AgentFn.Pipeline.Demo.Steps.Enrich do
  @moduledoc """
  Deep module: enriches args before the pipeline entry `run/1` finishes.
  """

  @spec apply(map()) :: map()
  def apply(args) when is_map(args) do
    Map.merge(%{"enriched" => true, "stage" => "enrich"}, args)
  end
end
