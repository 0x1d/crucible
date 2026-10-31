defmodule AgentFn.Md.Code do
  @moduledoc """
  Wrap text as a markdown fenced code block.

  Args:
  - `content` or `text` (required)
  - `lang` — optional language tag for the fence
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    content = Map.get(args, "content") || Map.get(args, :content) || Map.get(args, "text") || Map.get(args, :text)
    lang = Map.get(args, "lang") || Map.get(args, :lang) || ""

    cond do
      not is_binary(content) ->
        {:error, "content (or text) must be a string"}

      true ->
        lang_s = to_string(lang)
        fence = fence_for(content)
        markdown = fence <> lang_s <> "\n" <> content <> "\n" <> fence

        {:ok, %{"markdown" => markdown, "lang" => lang_s}}
    end
  end

  defp fence_for(content) do
    longest =
      Regex.scan(~r/`+/, content)
      |> Enum.map(fn [m] -> String.length(m) end)
      |> Enum.max(fn -> 2 end)

    String.duplicate("`", max(3, longest + 1))
  end
end