defmodule AgentFn.Http.Grep do
  @moduledoc """
  Fetch a URL (text) and return lines matching a regex, with context.

  Args:
  - `url` (required)
  - `pattern` (required) — Elixir/PCRE regex
  - `ignore_case` — default false
  - `context` — lines before/after each hit (default 0)
  - `max_matches` — default 50
  - `range` — optional `[start, end]` 1-based inclusive line range to return verbatim instead of grepping
  """
  @behaviour AgentFn.Tool

  alias AgentFn.Http.Get

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    url = args["url"]
    ctx = args["context"] || 0
    max = args["max_matches"] || 50

    with true <- is_binary(url) || {:error, "url is required"},
         {:ok, %{"status" => 200, "body" => body}} <-
           Get.run(%{"url" => url, "headers" => %{"User-Agent" => "alchemist"}, "timeout_ms" => 30_000}) do
      lines = String.split(body, "\n")
      total = length(lines)

      case args["range"] do
        [s, e] when is_integer(s) and is_integer(e) ->
          text =
            lines
            |> Enum.with_index(1)
            |> Enum.filter(fn {_, i} -> i >= s and i <= e end)
            |> Enum.map_join("\n", fn {l, i} -> "#{i}: #{l}" end)

          {:ok, %{"url" => url, "total_lines" => total, "text" => text}}

        _ ->
          pat = args["pattern"]

          if not is_binary(pat) do
            {:error, "pattern is required (or range)"}
          else
            opts = if args["ignore_case"], do: "i", else: ""

            case Regex.compile(pat, opts) do
              {:ok, re} ->
                indexed = Enum.with_index(lines, 1)
                hits = indexed |> Enum.filter(fn {l, _} -> Regex.match?(re, l) end) |> Enum.take(max)
                arr = List.to_tuple(lines)

                blocks =
                  Enum.map(hits, fn {_, i} ->
                    lo = max(1, i - ctx)
                    hi = min(total, i + ctx)
                    Enum.map_join(lo..hi, "\n", fn j -> "#{j}: #{elem(arr, j - 1)}" end)
                  end)

                {:ok,
                 %{
                   "url" => url,
                   "total_lines" => total,
                   "count" => length(hits),
                   "matches" => blocks
                 }}

              {:error, e} ->
                {:error, "bad regex: #{inspect(e)}"}
            end
          end
      end
    else
      {:ok, %{"status" => s}} -> {:error, "HTTP status #{s}"}
      {:error, e} -> {:error, to_string(e)}
    end
  end
end