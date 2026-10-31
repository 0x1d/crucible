defmodule AgentFn.Docker.PsReport do
  @moduledoc """
  Report Docker containers by composing `docker.ps`.

  Args:
  - `all` — if true, include stopped containers (default false)
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, listing} <- AgentFn.Docker.Ps.run(args) do
      {:ok,
       listing
       |> Map.put(:generated_at, DateTime.utc_now() |> DateTime.to_iso8601())}
    end
  end
end