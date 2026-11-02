defmodule AgentFn.Git.Commit do
  @moduledoc """
  Stage and commit an explicit list of files, optionally pushing.

  Only the listed paths are committed (`git commit -- <files>`), so anything
  else already staged or modified stays out of the commit. Never runs `git add -A`.

  Safety checks (run before anything is staged, also in `dry_run`):
  - refuses while a merge is in progress (`MERGE_HEAD` exists) — a partial
    commit is impossible then; finish the merge instead
  - refuses if any listed path is unmerged (status `UU`, `AA`, `DU`, ...)
    — `git add` would otherwise silently mark it resolved
  - refuses if any changed file in the list contains conflict markers
    (lines starting with `<<<<<<< ` or `>>>>>>> `); override with
    `allow_conflict_markers: true`

  Args:
  - `message` (required) — commit message (may contain newlines for a body)
  - `files` (required) — non-empty list of paths relative to the repo (dirs allowed)
  - `cwd` / `repo` — repository directory (default: runtime cwd)
  - `push` — when true, push the current branch after committing (default false)
  - `remote` — remote to push to (default `origin`)
  - `dry_run` — when true, report changes and check results without changing anything
  - `allow_conflict_markers` — skip the marker scan (default false)

  Returns `sha`, `short_sha`, `branch`, `stat`, `files`, `pushed`, and `push_output`.
  Fails if none of the listed files have changes.
  """

  alias AgentFn.Sys.Cmd

  @unmerged ~w(DD AU UD UA DU AA UU)
  @marker ~r/^(<<<<<<<|>>>>>>>)( |$)/m

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, message} <- fetch_message(args),
         {:ok, files} <- fetch_files(args),
         {:ok, cwd} <- fetch_cwd(args),
         {:ok, branch} <- git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
         {:ok, status} <- git(cwd, ["status", "--porcelain", "--untracked-files=all", "--" | files]) do
      remote = args["remote"] || "origin"
      push? = truthy?(args["push"])
      # porcelain lines are column-sensitive ("XY path"); never trim their leading space
      changes = String.split(status, "\n", trim: true)
      problems = conflict_problems(cwd, changes, truthy?(args["allow_conflict_markers"]))

      cond do
        truthy?(args["dry_run"]) ->
          {:ok,
           %{
             "dry_run" => true,
             "cwd" => cwd,
             "branch" => branch,
             "message" => message,
             "files" => files,
             "changes" => changes,
             "conflicts" => problems,
             "would_commit" => problems == [] and changes != [],
             "would_push" => push?,
             "remote" => remote
           }}

        problems != [] ->
          {:error, "refusing to commit: " <> Enum.join(problems, "; ")}

        changes == [] ->
          {:error, "nothing to commit: none of the listed files have changes"}

        true ->
          commit(cwd, branch, message, files, push?, remote)
      end
    end
  end

  def run(_), do: {:error, "args must be a map"}

  # --- conflict checks -------------------------------------------------------

  defp conflict_problems(cwd, changes, allow_markers?) do
    merge =
      if merge_in_progress?(cwd),
        do: ["a merge is in progress (MERGE_HEAD exists); finish or abort it first"],
        else: []

    unmerged =
      changes
      |> Enum.filter(&(code_of(&1) in @unmerged))
      |> Enum.map(&("unresolved conflict: " <> path_of(&1)))

    markers =
      if allow_markers? do
        []
      else
        changes
        |> Enum.reject(&(code_of(&1) in @unmerged))
        |> Enum.map(&path_of/1)
        |> Enum.flat_map(&marker_hits(cwd, &1))
      end

    merge ++ unmerged ++ markers
  end

  defp merge_in_progress?(cwd) do
    case git_raw(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]) do
      {:ok, 0, _} -> true
      _ -> false
    end
  end

  defp marker_hits(cwd, rel) do
    path = Path.join(cwd, rel)

    with true <- File.regular?(path),
         {:ok, content} <- File.read(path),
         true <- String.valid?(content) do
      lines =
        content
        |> String.split("\n")
        |> Enum.with_index(1)
        |> Enum.filter(fn {line, _} -> Regex.match?(@marker, line) end)
        |> Enum.map(fn {_, n} -> n end)

      if lines == [],
        do: [],
        else: ["conflict markers in #{rel} (lines #{Enum.join(Enum.take(lines, 5), ", ")})"]
    else
      _ -> []
    end
  end

  # porcelain v1: "XY path" or "XY old -> new"
  defp code_of(line), do: String.slice(line, 0, 2)

  defp path_of(line) do
    line
    |> String.slice(3..-1//1)
    |> String.split(" -> ")
    |> List.last()
    |> String.trim("\"")
  end

  # --- commit / push ---------------------------------------------------------

  defp commit(cwd, branch, message, files, push?, remote) do
    with {:ok, _} <- git(cwd, ["add", "--" | files]),
         {:ok, _} <- git(cwd, ["commit", "-m", message, "--" | files]),
         {:ok, sha} <- git(cwd, ["rev-parse", "HEAD"]),
         {:ok, stat} <- git(cwd, ["show", "--stat", "--format=", "HEAD"]),
         {:ok, push_output} <- maybe_push(cwd, push?, remote, branch) do
      {:ok,
       %{
         "cwd" => cwd,
         "branch" => branch,
         "sha" => String.trim(sha),
         "short_sha" => String.slice(String.trim(sha), 0, 7),
         "message" => message,
         "files" => files,
         "stat" => String.trim(stat),
         "pushed" => push?,
         "remote" => if(push?, do: remote, else: nil),
         "push_output" => push_output && String.trim(push_output)
       }}
    end
  end

  defp maybe_push(_cwd, false, _remote, _branch), do: {:ok, nil}

  defp maybe_push(cwd, true, remote, branch) do
    case git(cwd, ["push", remote, branch], 60_000, :combined) do
      {:ok, out} -> {:ok, out}
      {:error, e} -> {:error, "commit succeeded but push failed: " <> e}
    end
  end

  # --- git helpers -----------------------------------------------------------

  defp git_raw(cwd, argv, timeout \\ 30_000) do
    case Cmd.run(%{"argv" => ["git" | argv], "cwd" => cwd, "timeout_ms" => timeout}) do
      {:ok, r} ->
        {:ok, get(r, "status"), {get(r, "stdout") || "", get(r, "stderr") || ""}}

      {:error, e} ->
        {:error, "git #{Enum.join(argv, " ")}: #{inspect(e)}"}
    end
  end

  # Only trailing whitespace is trimmed: leading spaces are significant in porcelain output.
  defp git(cwd, argv, timeout \\ 30_000, output \\ :stdout) do
    case git_raw(cwd, argv, timeout) do
      {:ok, 0, {stdout, stderr}} ->
        out = if output == :combined, do: stdout <> stderr, else: stdout
        {:ok, String.trim_trailing(out)}

      {:ok, status, {stdout, stderr}} ->
        {:error,
         "git #{Enum.join(argv, " ")} failed (#{inspect(status)}): " <>
           String.trim(stderr <> "\n" <> stdout)}

      {:error, e} ->
        {:error, e}
    end
  end

  defp get(map, key), do: Map.get(map, key) || Map.get(map, String.to_atom(key))

  # --- arg parsing -----------------------------------------------------------

  defp fetch_message(%{"message" => m}) when is_binary(m) do
    if String.trim(m) == "", do: {:error, "message must not be empty"}, else: {:ok, m}
  end

  defp fetch_message(_), do: {:error, "message (string) is required"}

  defp fetch_files(%{"files" => files}) when is_list(files) and files != [] do
    if Enum.all?(files, &(is_binary(&1) and String.trim(&1) != "")) do
      {:ok, files}
    else
      {:error, "files must be a list of non-empty strings"}
    end
  end

  defp fetch_files(_), do: {:error, "files (non-empty list) is required"}

  defp fetch_cwd(args) do
    cwd = args["cwd"] || args["repo"] || File.cwd!()
    if File.dir?(cwd), do: {:ok, cwd}, else: {:error, "not a directory: #{cwd}"}
  end

  defp truthy?(v), do: v in [true, "true", 1, "1"]
end