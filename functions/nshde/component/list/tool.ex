defmodule AgentFn.Nshde.Component.List do
  @moduledoc """
  List the files under `components/` in nshde storage.

  Returns `paths` (sorted) and the storage `backend`.
  """
  @behaviour AgentFn.Tool

  alias AgentLib.Nshde

  @type args :: %{}

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, %{"tree" => tree} = data} <- Nshde.request("GET", "/api/storage?tree=1") do
      {:ok, %{"paths" => tree |> files() |> Enum.sort(), "backend" => data["backend"]}}
    else
      {:ok, _} -> {:error, "unexpected tree response"}
      {:error, message} -> {:error, message}
    end
  end

  defp files(nodes) when is_list(nodes), do: Enum.flat_map(nodes, &files/1)
  defp files(%{"kind" => "file", "path" => path}), do: [path]
  defp files(%{"children" => children}), do: files(children)
  defp files(_), do: []
end
