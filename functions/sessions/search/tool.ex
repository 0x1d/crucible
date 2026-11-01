defmodule AgentFn.Sessions.Search do
  @moduledoc """
  Search alchemist/Cursor session logs efficiently.

  Default target is the shared journal behind session `memory/` symlinks:
  `hosts/cursor/.agent-serve/cursor/memory/journal.jsonl`.
  Pass `path` / `root` to search anywhere else.

  Args:
  - `pattern` (required) — regex (or fixed string when `fixed_strings` is true)
  - `path` / `root` — override search root/file (default: shared journal)
  - `session_id` — optional substring filter on parsed `sessionId`
  - `ignore_case`, `fixed_strings`, `follow_symlinks`, `glob`, `max_matches`, `timeout_ms`
    — forwarded to `fs.rg`
  - `snippet` — max chars for `userMessage` / `result` snippets (default 180)

  Returns structured `hits` with `at`, `session_id`, `user_message`, `result`,
  plus raw `path` / `line`. Prefer this over grepping `.sessions/*/memory`
  (those dirs symlink to one journal).
  """
  @behaviour AgentFn.Tool

  @default_journal "/home/master/src/alchemist/hosts/cursor/.agent-serve/cursor/memory/journal.jsonl"

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    pattern = get(args, "pattern")
    path = get(args, "path") || get(args, "root") || @default_journal
    session_id = get(args, "session_id")
    snippet = get(args, "snippet") || 180
    max_matches = get(args, "max_matches") || 30

    # If caller points at the sessions tree, search the real journal instead
    # of walking a symlink forest.
    path = normalize_sessions_path(path)

    rg_args =
      args
      |> Map.put("pattern", pattern)
      |> Map.put("path", path)
      |> Map.put("max_matches", max_matches)
      |> Map.delete("session_id")
      |> Map.delete("snippet")
      |> then(fn m ->
        if get(m, "glob") || File.regular?(path),
          do: m,
          else: Map.put(m, "glob", "*.jsonl")
      end)

    with :ok <- require_bin(pattern, "pattern"),
         {:ok, rg} <- AgentFn.Fs.Rg.run(rg_args) do
      hits =
        rg["matches"]
        |> Enum.map(&enrich(&1, snippet))
        |> Enum.filter(&match_session?(&1, session_id))

      {:ok,
       %{
         "pattern" => pattern,
         "path" => path,
         "session_id" => session_id,
         "count" => length(hits),
         "hits" => hits,
         "truncated" => rg["truncated"],
         "raw_count" => rg["count"]
       }}
    end
  end

  defp normalize_sessions_path(path) do
    sessions_root = "/home/master/src/alchemist/hosts/cursor/.sessions"

    cond do
      path == sessions_root ->
        @default_journal

      String.starts_with?(path, sessions_root <> "/") and not File.regular?(path) ->
        # ses_* dir or memory symlink → canonical journal
        @default_journal

      true ->
        path
    end
  end

  defp enrich(%{"path" => path, "line" => line, "text" => text, "match" => match}, snippet) do
    parsed =
      case Jason.decode(text) do
        {:ok, map} when is_map(map) -> map
        _ -> %{}
      end

    %{
      "path" => path,
      "line" => line,
      "match" => match,
      "at" => parsed["at"],
      "session_id" => parsed["sessionId"] || parsed["sdkAgentId"],
      "channel" => parsed["channelId"],
      "status" => parsed["status"],
      "user_message" => clip(parsed["userMessage"], snippet),
      "result" => clip(parsed["result"], snippet),
      "text" => clip(text, snippet * 2)
    }
  end

  defp match_session?(_hit, sid) when not is_binary(sid) or sid == "", do: true

  defp match_session?(hit, sid) do
    case hit["session_id"] do
      id when is_binary(id) -> String.contains?(id, sid)
      _ -> false
    end
  end

  defp clip(nil, _), do: nil
  defp clip(text, n) when is_binary(text) and is_integer(n) and n > 0 do
    if String.length(text) <= n, do: text, else: String.slice(text, 0, n) <> "…"
  end

  defp clip(other, _), do: other

  defp require_bin(v, _name) when is_binary(v) and v != "", do: :ok
  defp require_bin(_, name), do: {:error, "#{name} is required"}

  defp get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, String.to_atom(key))
  end
end