defmodule AgentFn.Json.Stringify do
  @moduledoc """
  Encode a value as a JSON string.

  Args:
  - `value` or `data` (required)
  - `pretty` — optional boolean for pretty printing
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:data) => term(),
    optional(:pretty) => boolean(),
    optional(:value) => term()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    has_value? = Map.has_key?(args, "value") or Map.has_key?(args, :value)
    has_data? = Map.has_key?(args, "data") or Map.has_key?(args, :data)

    value =
      cond do
        has_value? -> Map.get(args, "value") || Map.get(args, :value)
        has_data? -> Map.get(args, "data") || Map.get(args, :data)
        true -> :missing
      end

    pretty? = truthy?(Map.get(args, "pretty") || Map.get(args, :pretty))

    cond do
      value == :missing ->
        {:error, "value (or data) is required"}

      true ->
        opts = if pretty?, do: [pretty: true], else: []

        case Jason.encode(value, opts) do
          {:ok, json} ->
            {:ok, %{"json" => json, "pretty" => pretty?, "bytes" => byte_size(json)}}

          {:error, err} ->
            {:error, "encode failed: #{Exception.message(err)}"}
        end
    end
  end

  defp truthy?(v) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(_), do: false
end