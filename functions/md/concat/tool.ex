defmodule AgentFn.Md.Concat do
  @moduledoc """
  Concatenate markdown parts into one document.

  Args:
  - `parts` (required) — list of strings, or maps containing a `markdown` key
  - `separator` — join string (default `"\\n\\n"`)
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    parts = Map.get(args, "parts") || Map.get(args, :parts)
    sep = Map.get(args, "separator") || Map.get(args, :separator) || "\n\n"

    cond do
      not is_list(parts) ->
        {:error, "parts must be a list"}

      not is_binary(sep) ->
        {:error, "separator must be a string"}

      true ->
        case Enum.reduce_while(parts, {:ok, []}, fn part, {:ok, acc} ->
               case normalize(part) do
                 {:ok, s} -> {:cont, {:ok, [s | acc]}}
                 {:error, _} = err -> {:halt, err}
               end
             end) do
          {:ok, rev} ->
            chunks = rev |> Enum.reverse() |> Enum.reject(&(&1 == ""))
            markdown = Enum.join(chunks, sep)

            {:ok, %{"markdown" => markdown, "part_count" => length(chunks)}}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  defp normalize(s) when is_binary(s), do: {:ok, s}

  defp normalize(%{} = m) do
    case Map.get(m, "markdown") || Map.get(m, :markdown) do
      s when is_binary(s) -> {:ok, s}
      _ -> {:error, "map parts must include a markdown string"}
    end
  end

  defp normalize(_), do: {:error, "parts must be strings or maps with markdown"}
end