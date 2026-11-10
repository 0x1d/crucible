defmodule AgentFn.Services.Greeting do
  @moduledoc """
  Greet someone by name.

  Example service for the nshde service gateway.
  Its schemas are in `meta.json` under `service`.

  Args:
  - `name` — who to greet
  """
  @behaviour AgentFn.Tool

  @type args :: %{required(:name) => String.t()}

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    case Map.get(args, "name") || Map.get(args, :name) do
      name when is_binary(name) and name != "" ->
        {:ok, %{"message" => "Hello, #{name}!", "at" => DateTime.utc_now() |> DateTime.to_iso8601()}}

      _ ->
        {:error, "name is required"}
    end
  end
end
