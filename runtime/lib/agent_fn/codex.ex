defmodule AgentFn.Codex do
  @moduledoc """
  Invoke another codex slug by name (dynamic dispatch).

  For static composition, prefer `alias AgentFn.Echo` and `Echo.run(args)` in your
  own modules after compile. Use `call/2` when the slug comes from runtime data.
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
      other -> {:error, "unexpected codex response: #{inspect(other)}"}
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
