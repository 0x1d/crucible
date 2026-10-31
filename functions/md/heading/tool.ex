defmodule AgentFn.Md.Heading do
  @moduledoc """
  Render a markdown ATX heading.

  Args:
  - `text` or `content` (required)
  - `level` — 1..6 (default 1)
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    text = Map.get(args, "text") || Map.get(args, :text) || Map.get(args, "content") || Map.get(args, :content)
    level = Map.get(args, "level") || Map.get(args, :level) || 1

    cond do
      not is_binary(text) ->
        {:error, "text (or content) must be a string"}

      not is_integer(level) or level < 1 or level > 6 ->
        {:error, "level must be an integer 1..6"}

      true ->
        line = String.trim(text) |> String.replace(~r/\s+/, " ")
        markdown = String.duplicate("#", level) <> " " <> line

        {:ok, %{"markdown" => markdown, "level" => level}}
    end
  end
end