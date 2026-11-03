defmodule AgentFn.Git.Status do
  @moduledoc """
  Structured git working-tree status for one repository.

  Runs `git status --porcelain=v1 -z --branch` (NUL-separated, so paths with
  spaces, quotes or non-ASCII bytes come through exactly as they are) and parses it.

  Args:
  - `cwd` / `repo` — repository directory (default: runtime cwd)
  - `paths` — optional list of pathspecs to limit the report (passed after `--`)
  - `untracked` — `"all"` (default), `"normal"` (collapse untracked dirs), or `"no"`
  - `ignored` — when true, also list ignored files (default false)

  Returns:
  - `branch`, `upstream`, `ahead`, `behind`, `detached`, `clean`
  - `entries` — list of `%{path, orig_path, index, worktree, code}` (raw XY codes)
  - `staged`, `unstaged`, `untracked`, `conflicted`, `ignored` — path lists
  - `counts` — size of each list
  """

  alias AgentFn.Sys.Cmd

  @unmerged ~w(DD AU UD UA DU AA UU)

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, cwd} <- fetch_cwd(args),
         {:ok, paths} <- fetch_paths(args),
         {:ok, untracked} <- fetch_untracked(args),
         {:ok, out} <- git(cwd, build_argv(untracked, truthy?(args["ignored"]), paths)) do
      {header, entries} = parse(out)
      branch_info = parse_branch(header)

      groups = %{
        "staged" => for(e <- entries, staged?(e), do: e["path"]),
        "unstaged" => for(e <- entries, unstaged?(e), do: e["path"]),
        "untracked" => for(e <- entries, e["code"] == "??", do: e["path"]),
        "conflicted" => for(e <- entries, e["code"] in @unmerged, do: e["path"]),
        "ignored" => for(e <- entries, e["code"] == "!!", do: e["path"])
      }

      counts = Map.new(groups, fn {k, v} -> {k, length(v)} end)
      clean = Enum.all?(entries, &(&1["code"] == "!!"))

      {:ok,
       branch_info
       |> Map.merge(groups)
       |> Map.merge(%{
         "cwd" => cwd,
         "clean" => clean,
         "entries" => entries,
         "counts" => counts
       })}
    end
  end

  def run(_), do: {:error, "args must be a map"}

  # --- argv -----------------------------------------------------------------

  defp build_argv(untracked, ignored?, paths) do
    base = ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=" <> untracked]
    base = if ignored?, do: base ++ ["--ignored"], else: base
    if paths == [], do: base, else: base ++ ["--" | paths]
  end

  # --- parsing --------------------------------------------------------------

  # -z output: records separated by NUL. The first is "## <branch info>".
  # Renames/copies ("R"/"C" in either column) are followed by an extra
  # record holding the original path.
  defp parse(out) do
    records = String.split(out, <<0>>, trim: true)

    {header, rest} =
      case records do
        ["## " <> h | rest] -> {h, rest}
        rest -> {nil, rest}
      end

    {header, parse_entries(rest, [])}
  end

  defp parse_entries([], acc), do: Enum.reverse(acc)

  defp parse_entries([rec | rest], acc) when byte_size(rec) >= 4 do
    <<x::binary-size(1), y::binary-size(1), " ", path::binary>> = rec
    code = x <> y

    {orig, rest} =
      if x in ["R", "C"] or y in ["R", "C"] do
        case rest do
          [o | r] -> {o, r}
          [] -> {nil, []}
        end
      else
        {nil, rest}
      end

    entry = %{
      "code" => code,
      "index" => x,
      "worktree" => y,
      "path" => path,
      "orig_path" => orig
    }

    parse_entries(rest, [entry | acc])
  end

  defp parse_entries([_junk | rest], acc), do: parse_entries(rest, acc)

  defp staged?(%{"code" => c, "index" => x}),
    do: c not in @unmerged and x not in [" ", "?", "!"]

  defp unstaged?(%{"code" => c, "worktree" => y}),
    do: c not in @unmerged and y not in [" ", "?", "!"]

  # Header forms:
  #   main...origin/main [ahead 1, behind 2]
  #   main
  #   No commits yet on main
  #   HEAD (no branch)
  defp parse_branch(nil),
    do: %{"branch" => nil, "upstream" => nil, "ahead" => 0, "behind" => 0, "detached" => false}

  defp parse_branch(header) do
    {head, track} =
      case Regex.run(~r/^(.*?)(?: \[(.*)\])?$/, header) do
        [_, h, t] -> {h, t}
        [_, h] -> {h, ""}
        _ -> {header, ""}
      end

    head = String.replace_prefix(head, "No commits yet on ", "")
    head = String.replace_prefix(head, "Initial commit on ", "")

    {branch, upstream} =
      case String.split(head, "...", parts: 2) do
        [b, u] -> {b, u}
        [b] -> {b, nil}
      end

    detached = branch == "HEAD (no branch)"

    %{
      "branch" => if(detached, do: nil, else: branch),
      "upstream" => upstream,
      "ahead" => track_num(track, "ahead"),
      "behind" => track_num(track, "behind"),
      "detached" => detached,
      "upstream_gone" => String.contains?(track, "gone")
    }
  end

  defp track_num(track, word) do
    case Regex.run(~r/#{word} (\d+)/, track) do
      [_, n] -> String.to_integer(n)
      _ -> 0
    end
  end

  # --- git helper -----------------------------------------------------------

  defp git(cwd, argv) do
    case Cmd.run(%{"argv" => ["git" | argv], "cwd" => cwd, "timeout_ms" => 30_000}) do
      {:ok, r} ->
        case get(r, "status") do
          0 ->
            {:ok, get(r, "stdout") || ""}

          s ->
            {:error,
             "git #{Enum.join(argv, " ")} failed (#{inspect(s)}): " <>
               String.trim((get(r, "stderr") || "") <> "\n" <> (get(r, "stdout") || ""))}
        end

      {:error, e} ->
        {:error, "git #{Enum.join(argv, " ")}: #{inspect(e)}"}
    end
  end

  defp get(map, key), do: Map.get(map, key) || Map.get(map, String.to_atom(key))

  # --- arg parsing ----------------------------------------------------------

  defp fetch_cwd(args) do
    cwd = args["cwd"] || args["repo"] || File.cwd!()
    if File.dir?(cwd), do: {:ok, cwd}, else: {:error, "not a directory: #{cwd}"}
  end

  defp fetch_paths(args) do
    case args["paths"] do
      nil -> {:ok, []}
      p when is_binary(p) and p != "" -> {:ok, [p]}
      l when is_list(l) ->
        if Enum.all?(l, &(is_binary(&1) and &1 != "")),
          do: {:ok, l},
          else: {:error, "paths must be a list of non-empty strings"}
      _ -> {:error, "paths must be a list of non-empty strings"}
    end
  end

  defp fetch_untracked(args) do
    case args["untracked"] do
      nil -> {:ok, "all"}
      true -> {:ok, "all"}
      false -> {:ok, "no"}
      v when v in ["all", "normal", "no"] -> {:ok, v}
      v -> {:error, "untracked must be \"all\", \"normal\" or \"no\" (got #{inspect(v)})"}
    end
  end

  defp truthy?(v), do: v in [true, "true", 1, "1"]
end