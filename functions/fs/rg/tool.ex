defmodule AgentFn.Fs.Rg do
  @moduledoc """
  Efficient recursive search via ripgrep (`rg`).

  Args:
  - `pattern` (required) — regex (or fixed string when `fixed_strings` is true)
  - `path` / `root` (required) — file or directory to search
  - `glob` — optional ripgrep `--glob` (e.g. `*.jsonl`, `**/journal.jsonl`)
  - `ignore_case` — optional boolean
  - `fixed_strings` — optional boolean (`-F`)
  - `follow_symlinks` — optional boolean (`-L`, default false)
  - `max_matches` — optional cap across all files (default 50)
  - `timeout_ms` — optional (default 60_000)

  Returns `matches` as `%{path, line, text, match}` maps.
  Dedupes by `{line, text}` so symlink forests (session dirs → one journal)
  collapse to unique hits.
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    pattern = get(args, "pattern")
    path = get(args, "path") || get(args, "root")
    glob = get(args, "glob")
    ignore_case? = truthy?(get(args, "ignore_case"))
    fixed? = truthy?(get(args, "fixed_strings"))
    follow? = truthy?(get(args, "follow_symlinks"))
    max_matches = get(args, "max_matches") || 50
    timeout = get(args, "timeout_ms") || 60_000

    with :ok <- require_bin(pattern, "pattern"),
         :ok <- require_bin(path, "path"),
         true <- File.exists?(path) || {:error, "path not found: #{path}"},
         true <-
           (is_integer(max_matches) and max_matches > 0) ||
             {:error, "max_matches must be a positive integer"},
         {:ok, rg} <- find_rg(),
         argv <- build_argv(rg, pattern, path, glob, ignore_case?, fixed?, follow?, max_matches),
         {:ok, stdout, status} <- exec(argv, timeout) do
      if status > 1 do
        {:error, "rg failed (status #{status}): #{String.trim(stdout)}"}
      else
        matches =
          stdout
          |> parse_matches()
          |> Enum.take(max_matches)

        {:ok,
         %{
           "pattern" => pattern,
           "path" => path,
           "glob" => glob,
           "count" => length(matches),
           "matches" => matches,
           "truncated" => length(matches) >= max_matches,
           "rg" => rg
         }}
      end
    else
      {:error, reason} -> {:error, reason}
      false -> {:error, "invalid arguments"}
    end
  end

  defp build_argv(rg, pattern, path, glob, ignore_case?, fixed?, follow?, max_matches) do
    [rg, "--json", "-m", Integer.to_string(max_matches)]
    |> maybe_flag(ignore_case?, "--ignore-case")
    |> maybe_flag(fixed?, "--fixed-strings")
    |> maybe_flag(follow?, "--follow")
    |> maybe_glob(glob)
    |> Kernel.++(["--", pattern, path])
  end

  defp maybe_flag(argv, true, flag), do: argv ++ [flag]
  defp maybe_flag(argv, _, _), do: argv

  defp maybe_glob(argv, glob) when is_binary(glob) and glob != "",
    do: argv ++ ["--glob", glob]

  defp maybe_glob(argv, _), do: argv

  defp parse_matches(stdout) do
    stdout
    |> String.split("\n", trim: true)
    |> Enum.flat_map(fn line ->
      case Jason.decode(line) do
        {:ok, %{"type" => "match", "data" => data}} ->
          path = get_in(data, ["path", "text"]) || ""
          line_no = data["line_number"]
          text = data |> get_in(["lines", "text"]) |> to_string() |> String.trim_trailing("\n")

          match_text =
            case data["submatches"] do
              [%{"match" => %{"text" => m}} | _] -> m
              _ -> nil
            end

          [%{"path" => path, "line" => line_no, "text" => text, "match" => match_text}]

        _ ->
          []
      end
    end)
    |> dedupe()
  end

  defp dedupe(matches) do
    {acc, _seen} =
      Enum.reduce(matches, {[], MapSet.new()}, fn hit, {acc, seen} ->
        key = {hit["line"], hit["text"]}

        if MapSet.member?(seen, key) do
          {acc, seen}
        else
          {[hit | acc], MapSet.put(seen, key)}
        end
      end)

    Enum.reverse(acc)
  end

  defp find_rg do
    candidates =
      [System.find_executable("rg"), "/home/master/src/alchemist/node_modules/.bin/rg"]
      |> Enum.reject(&is_nil/1)

    case Enum.find(candidates, &File.regular?/1) do
      nil -> {:error, "rg (ripgrep) not found on PATH"}
      path -> {:ok, path}
    end
  end

  defp exec([exe | rest], timeout) do
    task = Task.async(fn -> System.cmd(exe, rest, stderr_to_stdout: true) end)

    case Task.yield(task, timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, {stdout, status}} -> {:ok, stdout, status}
      nil -> {:error, "rg timed out after #{timeout}ms"}
      {:exit, reason} -> {:error, "rg failed: #{inspect(reason)}"}
    end
  end

  defp require_bin(v, _name) when is_binary(v) and v != "", do: :ok
  defp require_bin(_, name), do: {:error, "#{name} is required"}

  defp get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, String.to_atom(key))
  end

  defp truthy?(v) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(_), do: false
end