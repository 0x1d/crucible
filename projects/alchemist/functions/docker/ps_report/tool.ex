defmodule AgentFn.Docker.PsReport do
  @moduledoc """
  Summarize Docker containers from `docker.ps`.

  Args:
  - `all` — if true, include stopped containers (default false)

  Returns `count`, `by_state`, `by_project`, `by_image`, and `published_ports`.
  The container list stays out of the result.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:all) => boolean()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, listing} <- AgentFn.Docker.Ps.run(args) do
      {:ok, summarize(Map.get(listing, :containers, []))}
    end
  end

  @spec summarize([map()]) :: map()
  def summarize(containers) when is_list(containers) do
    %{
      count: length(containers),
      by_state: frequencies(containers, :state),
      by_project: frequencies(containers, :project),
      by_image: frequencies(containers, :image),
      published_ports: published_ports(containers)
    }
  end

  defp frequencies(containers, key) do
    containers
    |> Enum.frequencies_by(fn container -> Map.get(container, key) || "(none)" end)
    |> Map.new()
  end

  defp published_ports(containers) do
    Enum.flat_map(containers, fn container ->
      ports = Map.get(container, :ports)

      if is_binary(ports) and ports != "" do
        [%{name: Map.get(container, :name), ports: ports}]
      else
        []
      end
    end)
  end
end
