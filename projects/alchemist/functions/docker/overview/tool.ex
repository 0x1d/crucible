defmodule AgentFn.Docker.Overview do
  @moduledoc """
  Short Docker overview: counts by Compose project, image, and state, plus published ports.

  Args:
  - `all` — if true, include stopped containers (default false)

  Same result as `docker.ps_report`. Use this before `docker.ps` or `docker inspect`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:all) => boolean()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args), do: AgentFn.Docker.PsReport.run(args)
end
