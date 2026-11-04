defmodule AgentFn.Text.Grep do
  @moduledoc """
  Search text with a regular expression.

  Args:
  - `pattern` (required) — regex source
  - `text` or `path` — subject (exactly one)
  - `ignore_case` — optional boolean
  - `max_matches` — optional cap (default 1000)

  Returns `matches` as `%{line, column, text, match}` maps.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:ignore_case) => boolean(),
    optional(:max_matches) => non_neg_integer(),
    optional(:path) => String.t(),
    required(:pattern) => String.t(),
    optional(:text) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    pattern = Map.get(args, "pattern") || Map.get(args, :pattern)
    text = Map.get(args, "text") || Map.get(args, :text)
    path = Map.get(args, "path") || Map.get(args, :path)
    ignore_case? = truthy?(Map.get(args, "ignore_case") || Map.get(args, :ignore_case))
    max_matches = Map.get(args, "max_matches") || Map.get(args, :max_matches) || 1000

    with {:ok, subject, source} <- resolve_subject(text, path),
         {:ok, regex} <- compile(pattern, ignore_case?),
         true <- is_integer(max_matches) and max_matches > 0 ||
                   {:error, "max_matches must be a positive integer"} do
      matches =
        subject
        |> String.split("\n")
        |> Enum.with_index(1)
        |> Enum.flat_map(fn {line, line_no} ->
          Regex.scan(regex, line, return: :index)
          |> Enum.map(fn [{start, len} | _] ->
            %{
              "line" => line_no,
              "column" => start + 1,
              "text" => line,
              "match" => binary_part(line, start, len)
            }
          end)
        end)
        |> Enum.take(max_matches)

      {:ok,
       %{
         "pattern" => pattern,
         "source" => source,
         "count" => length(matches),
         "matches" => matches,
         "truncated" => length(matches) >= max_matches
       }}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp resolve_subject(text, path) when is_binary(text) and (not is_binary(path) or path == ""),
    do: {:ok, text, "text"}

  defp resolve_subject(text, path) when (not is_binary(text) or text == "") and is_binary(path) do
    cond do
      File.regular?(path) ->
        case File.read(path) do
          {:ok, content} -> {:ok, content, path}
          {:error, reason} -> {:error, "failed to read #{path}: #{inspect(reason)}"}
        end

      File.dir?(path) ->
        read_directory(path)

      true ->
        {:error, "failed to read #{path}: :enoent"}
    end
  end

  defp resolve_subject(_, _), do: {:error, "provide exactly one of text or path"}

  defp read_directory(root) do
    files =
      root
      |> Path.join("**/*")
      |> Path.wildcard()
      |> Enum.filter(&File.regular?/1)
      |> Enum.take(200)

    if files == [] do
      {:error, "no files under #{root}"}
    else
      parts =
        Enum.flat_map(files, fn file ->
          case File.read(file) do
            {:ok, content} -> ["=== #{file} ===\n#{content}"]
            _ -> []
          end
        end)

      {:ok, Enum.join(parts, "\n\n"), root}
    end
  end

  defp compile(pattern, _) when not is_binary(pattern) or pattern == "",
    do: {:error, "pattern is required"}

  defp compile(pattern, ignore_case?) do
    opts = if ignore_case?, do: [:caseless], else: []

    case Regex.compile(pattern, opts) do
      {:ok, _} = ok -> ok
      {:error, {reason, _}} -> {:error, "invalid pattern: #{inspect(reason)}"}
    end
  end

  defp truthy?(v) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(_), do: false
end