defmodule AgentFn.Json.Parse do
  @moduledoc """
  Parse JSON into Elixir data (maps/lists with string keys).

  Args:
  - `text`, `json`, or `content` — JSON string
  - or `path` — file containing JSON
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    text =
      Map.get(args, "text") || Map.get(args, :text) || Map.get(args, "json") || Map.get(args, :json) ||
        Map.get(args, "content") || Map.get(args, :content)

    path = Map.get(args, "path") || Map.get(args, :path)

    with {:ok, raw, source} <- resolve(text, path),
         {:ok, value} <- decode(raw) do
      {:ok, %{"value" => value, "source" => source}}
    end
  end

  defp resolve(text, path) when is_binary(text) and (not is_binary(path) or path == ""),
    do: {:ok, text, "text"}

  defp resolve(text, path) when (not is_binary(text) or text == "") and is_binary(path) do
    case File.read(path) do
      {:ok, content} -> {:ok, content, path}
      {:error, reason} -> {:error, "failed to read #{path}: #{inspect(reason)}"}
    end
  end

  defp resolve(_, _), do: {:error, "provide exactly one of text/json/content or path"}

  defp decode(raw) do
    case Jason.decode(raw) do
      {:ok, value} -> {:ok, value}
      {:error, %Jason.DecodeError{} = err} -> {:error, "invalid JSON: #{Exception.message(err)}"}
    end
  end
end