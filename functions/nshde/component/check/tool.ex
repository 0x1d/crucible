defmodule AgentFn.Nshde.Component.Check do
  @moduledoc """
  Compile a component with nshde's Sucrase step and return its errors.

  nshde runs the same transform as the preview loader, checks the imports
  (`react` and `@nshde/services` only), the default export, and that every
  service the source calls is declared in `export const capabilities`.

  Args:
  - `source` — TSX source to check
  - Or `slug` / `path` — check the stored component

  Returns `ok`, `errors` (each `message`, optional `line` and `column`), and
  the declared `capabilities`.
  """
  @behaviour AgentFn.Tool

  alias AgentLib.Nshde

  @type args :: %{
    optional(:path) => String.t(),
    optional(:slug) => String.t(),
    optional(:source) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    case Nshde.get(args, "source") do
      source when is_binary(source) ->
        Nshde.request("POST", "/api/modules/check", %{"source" => source})

      _ ->
        with {:ok, path} <- Nshde.component_path(args) do
          Nshde.request("POST", "/api/modules/check", %{"path" => path})
        end
    end
  end
end
