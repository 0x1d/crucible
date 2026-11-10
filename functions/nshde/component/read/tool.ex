defmodule AgentFn.Nshde.Component.Read do
  @moduledoc """
  Read a component's source from nshde storage.

  Args:
  - `slug` — kebab-case name (`todo-list`), or `path` under `components/`
  """
  @behaviour AgentFn.Tool

  alias AgentLib.Nshde

  @type args :: %{
    optional(:path) => String.t(),
    optional(:slug) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, path} <- Nshde.component_path(args),
         {:ok, %{"content" => content}} <- Nshde.request("GET", "/api/storage?path=" <> URI.encode_www_form(path)) do
      {:ok, %{"path" => path, "source" => content}}
    else
      {:ok, _} -> {:error, "component is not text"}
      {:error, message} -> {:error, message}
    end
  end
end
