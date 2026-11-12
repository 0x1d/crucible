defmodule AgentFn.Text.Slice do
  @moduledoc """
  Slice text by head/tail lines or an inclusive line range.

  Args:
  - `text` or `path` — subject (exactly one)
  - `head` — first N lines
  - `tail` — last N lines
  - `start_line` / `end_line` — inclusive 1-based range

  Prefer one mode: `head`, `tail`, or `start_line`(+optional `end_line`).
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:end_line) => pos_integer(),
    optional(:head) => non_neg_integer(),
    optional(:path) => String.t(),
    optional(:start_line) => pos_integer(),
    optional(:tail) => non_neg_integer(),
    optional(:text) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    text = Map.get(args, "text") || Map.get(args, :text)
    path = Map.get(args, "path") || Map.get(args, :path)
    head = Map.get(args, "head") || Map.get(args, :head)
    tail = Map.get(args, "tail") || Map.get(args, :tail)
    start_line = Map.get(args, "start_line") || Map.get(args, :start_line)
    end_line = Map.get(args, "end_line") || Map.get(args, :end_line)

    with {:ok, subject, source} <- resolve_subject(text, path) do
      lines = String.split(subject, "\n")
      total = length(lines)

      case select(lines, head, tail, start_line, end_line) do
        {:ok, chosen, mode} ->
          {:ok,
           %{
             "source" => source,
             "mode" => mode,
             "line_count" => length(chosen),
             "total_lines" => total,
             "content" => Enum.join(chosen, "\n")
           }}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp resolve_subject(text, path) when is_binary(text) and (not is_binary(path) or path == ""),
    do: {:ok, text, "text"}

  defp resolve_subject(text, path) when (not is_binary(text) or text == "") and is_binary(path) do
    case File.read(path) do
      {:ok, content} -> {:ok, content, path}
      {:error, reason} -> {:error, "failed to read #{path}: #{inspect(reason)}"}
    end
  end

  defp resolve_subject(_, _), do: {:error, "provide exactly one of text or path"}

  defp select(lines, head, nil, nil, nil) when is_integer(head) and head >= 0,
    do: {:ok, Enum.take(lines, head), "head"}

  defp select(lines, nil, tail, nil, nil) when is_integer(tail) and tail >= 0,
    do: {:ok, Enum.take(lines, -tail), "tail"}

  defp select(lines, nil, nil, start_line, end_line)
       when is_integer(start_line) and start_line >= 1 do
    last =
      cond do
        is_integer(end_line) and end_line >= start_line -> end_line
        is_nil(end_line) -> length(lines)
        true -> :bad
      end

    if last == :bad do
      {:error, "end_line must be >= start_line"}
    else
      chosen =
        lines
        |> Enum.with_index(1)
        |> Enum.filter(fn {_, i} -> i >= start_line and i <= last end)
        |> Enum.map(&elem(&1, 0))

      {:ok, chosen, "range"}
    end
  end

  defp select(_, _, _, _, _), do: {:error, "provide head, tail, or start_line"}
end