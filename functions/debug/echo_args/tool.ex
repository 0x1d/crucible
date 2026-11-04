defmodule AgentFn.Debug.EchoArgs do
  @behaviour AgentFn.Tool
  @type args :: %{optional(String.t()) => term()}

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}

  def run(args) when is_map(args) do
    keys = args |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort()
    has_desc = Map.has_key?(args, "description") or Map.has_key?(args, :description)
    {:ok, %{keys: keys, has_description: has_desc, args: args}}
  end
end
