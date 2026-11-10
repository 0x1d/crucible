defmodule AgentFn.Nshde.Component.Write do
  @moduledoc """
  Write a component to nshde storage as `components/<slug>.nsh.tsx`.

  The source is checked first (`nshde.component.check`); a source with
  errors is not written and the errors are returned.
  The nshde preview hot-mounts the written component.

  Args:
  - `slug` — kebab-case name (`todo-list`), or `path` under `components/`
  - `source` — TSX with a default-exported React component
  """
  @behaviour AgentFn.Tool

  alias AgentLib.Nshde

  @type args :: %{
    optional(:path) => String.t(),
    optional(:slug) => String.t(),
    required(:source) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, path} <- Nshde.component_path(args),
         {:source, source} when is_binary(source) <- {:source, Nshde.get(args, "source")},
         {:ok, %{"ok" => true} = check} <- Nshde.request("POST", "/api/modules/check", %{"source" => source}),
         {:ok, _} <- Nshde.request("POST", "/api/storage", %{"path" => path, "content" => source}) do
      {:ok, %{"path" => path, "bytes" => byte_size(source), "capabilities" => check["capabilities"] || []}}
    else
      {:source, _} -> {:error, "source is required"}
      {:ok, %{"errors" => errors}} -> {:error, "component does not compile: " <> format(errors)}
      {:ok, other} -> {:error, "unexpected check response: #{inspect(other)}"}
      {:error, message} -> {:error, message}
    end
  end

  defp format(errors) when is_list(errors) do
    errors
    |> Enum.map(fn
      %{"message" => message, "line" => line} when is_integer(line) -> "line #{line}: #{message}"
      %{"message" => message} -> message
      other -> inspect(other)
    end)
    |> Enum.join("; ")
  end

  defp format(other), do: inspect(other)
end
