defmodule AgentFn.Registry do
  @moduledoc """
  Call other registry tools from Elixir (composition / higher-order workflows).

      AgentFn.Registry.call("echo", %{"msg" => "hi"})

  Slugs use dot namespaces: `"data.pipeline.normalize"` → `AgentFn.Data.Pipeline.Normalize`.
  """

  alias Runtime.Engine

  @type slug :: String.t()
  @type args :: map()
  @type result :: {:ok, term()} | {:error, String.t()}

  @spec call(slug, args) :: result
  def call(slug, args) when is_binary(slug) and is_map(args) do
    case Engine.call(slug, args) do
      %{ok: true, result: value} -> {:ok, value}
      %{ok: false, error: message} -> {:error, to_string(message)}
      other -> {:error, "unexpected registry response: #{inspect(other)}"}
    end
  end

  @spec list() :: [map()]
  def list do
    case Engine.find("") do
      %{functions: functions} when is_list(functions) -> functions
      _ -> []
    end
  end
end
