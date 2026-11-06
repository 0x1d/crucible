defmodule AgentFn.Git.Log do
  @moduledoc """
  Structured git commit history for one repository.

  Runs `git log` with record/unit separators (so subjects and bodies with any
  characters parse safely) and optional `--numstat` for per-file line counts.

  Args:
  - `cwd` / `repo` — repository directory (default: runtime cwd)
  - `limit` — max commits (default 8, 1..500)
  - `ref` — revision or range, e.g. `"HEAD"`, `"main"`, `"v1..HEAD"` (default `HEAD`);
    must not start with `-`
  - `since`, `until` — git date expressions (`"3 days ago"`, `"2026-11-01"`)
  - `author` — author filter (git `--author` regex)
  - `paths` — optional list of pathspecs (passed after `--`)
  - `no_merges` — skip merge commits (default false)
  - `first_parent` — follow only the first parent (default false)
  - `numstat` — include per-file line counts (default false). Turn on for
    analytics/CI; agent status turns should use oneline git instead. Merge commits have
    no numstat (git default), so their `files` is empty.

  Returns `commits` — list of
  `%{"sha", "short", "author", "email", "date", "subject", "body", "parents",
  "merge", "files", "added", "deleted"}` where each file is
  `%{"path", "orig_path", "added", "deleted", "binary"}` — plus `count`, `branch`, `ref`.
  """

  alias AgentFn.Sys.Cmd

  @rs <<0x1E>>
  @us <<0x1F>>
  @format "%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s%x1f%b%x1f"
  @type args :: %{
    optional(:author) => String.t(),
    optional(:cwd) => String.t(),
    optional(:first_parent) => boolean(),
    optional(:limit) => non_neg_integer(),
    optional(:no_merges) => boolean(),
    optional(:paths) => [String.t()],
    optional(:ref) => String.t(),
    optional(:repo) => String.t(),
    optional(:since) => String.t(),
    optional(:until) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    cwd = args["cwd"] || args["repo"] || File.cwd!()
    ref = args["ref"] || "HEAD"
    limit = args["limit"] |> to_int(8) |> max(1) |> min(500)

    with :ok <- check_opt("ref", ref),
         :ok <- check_opt("since", args["since"]),
         :ok <- check_opt("until", args["until"]),
         :ok <- check_opt("author", args["author"]),
         {:ok, paths} <- check_paths(args["paths"]),
         {:ok, branch} <- git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
         {:ok, raw} <- git(cwd, argv(args, ref, limit, paths)) do
      commits = parse(raw)
      {:ok, %{"commits" => commits, "count" => length(commits), "branch" => String.trim(branch), "ref" => ref}}
    end
  end

  def run(_), do: {:error, "args must be a map"}

  @doc "Builds the `git log` argv (without `git -C dir`)."
  @spec argv(map(), String.t(), pos_integer(), [String.t()]) :: [String.t()]
  def argv(args, ref, limit, paths) do
    ["log", "-n", Integer.to_string(limit), "--no-color", "--pretty=format:" <> @format] ++
      flag(Map.get(args, "numstat", false) == true, "--numstat") ++
      flag(args["no_merges"] == true, "--no-merges") ++
      flag(args["first_parent"] == true, "--first-parent") ++
      opt("--since=", args["since"]) ++
      opt("--until=", args["until"]) ++
      opt("--author=", args["author"]) ++
      [ref, "--"] ++ paths
  end

  @doc "Parses raw `git log` output produced with this module's format."
  @spec parse(String.t()) :: [map()]
  def parse(raw) do
    raw
    |> String.split(@rs, trim: true)
    |> Enum.flat_map(fn rec ->
      case String.split(rec, @us, parts: 9) do
        [sha, short, author, email, date, parents, subject, body, rest] ->
          files = parse_numstat(rest)
          parents = String.split(parents, " ", trim: true)

          [
            %{
              "sha" => sha,
              "short" => short,
              "author" => author,
              "email" => email,
              "date" => date,
              "parents" => parents,
              "merge" => length(parents) > 1,
              "subject" => subject,
              "body" => String.trim(body),
              "files" => files,
              "added" => sum(files, "added"),
              "deleted" => sum(files, "deleted")
            }
          ]

        _ ->
          []
      end
    end)
  end

  @doc "Parses `--numstat` lines into file maps (renames expanded)."
  @spec parse_numstat(String.t()) :: [map()]
  def parse_numstat(text) do
    text
    |> String.split("\n", trim: true)
    |> Enum.flat_map(fn line ->
      case String.split(line, "\t", parts: 3) do
        [a, d, spec] ->
          {path, orig} = expand_rename(spec)
          [%{"path" => path, "orig_path" => orig, "added" => num(a), "deleted" => num(d), "binary" => a == "-"}]

        _ ->
          []
      end
    end)
  end

  @doc """
  Expands git's numstat rename notation into `{new_path, orig_path | nil}`:
  `"a/{x => y}/f"` → `{"a/y/f", "a/x/f"}`, `"old => new"` → `{"new", "old"}`.
  """
  @spec expand_rename(String.t()) :: {String.t(), String.t() | nil}
  def expand_rename(spec) do
    cond do
      m = Regex.run(~r/^(.*)\{(.*) => (.*)\}(.*)$/, spec) ->
        [_, pre, old, new, post] = m
        {join(pre, new, post), join(pre, old, post)}

      String.contains?(spec, " => ") ->
        [old, new] = String.split(spec, " => ", parts: 2)
        {new, old}

      true ->
        {spec, nil}
    end
  end

  # `{old => new}` may be empty on one side: "a/{ => b}/f" -> "a/b/f", "a/{b => }/f" -> "a/f"
  defp join(pre, mid, post),
    do: (pre <> mid <> post) |> String.replace("//", "/") |> String.trim_leading("/")

  # ---------- git ----------

  defp git(cwd, argv) do
    case Cmd.run(%{"argv" => ["git", "-C", cwd | argv], "timeout_ms" => 30_000}) do
      {:ok, res} ->
        if get(res, :status) == 0,
          do: {:ok, get(res, :stdout) || ""},
          else: {:error, "git #{hd(argv)} failed: " <> String.trim(get(res, :stderr) || "")}

      {:error, e} ->
        {:error, "git failed: #{inspect(e)}"}
    end
  end

  # ---------- validation ----------

  defp check_opt(_name, nil), do: :ok

  defp check_opt(name, v) when is_binary(v) do
    cond do
      v == "" -> {:error, "#{name} must not be empty"}
      String.starts_with?(v, "-") -> {:error, "#{name} must not start with '-'"}
      true -> :ok
    end
  end

  defp check_opt(name, _), do: {:error, "#{name} must be a string"}

  defp check_paths(nil), do: {:ok, []}

  defp check_paths(p) when is_list(p) do
    if Enum.all?(p, &is_binary/1), do: {:ok, p}, else: {:error, "paths must be a list of strings"}
  end

  defp check_paths(p) when is_binary(p), do: {:ok, [p]}
  defp check_paths(_), do: {:error, "paths must be a list of strings"}

  # ---------- helpers ----------

  defp flag(true, f), do: [f]
  defp flag(_, _), do: []

  defp opt(_, nil), do: []
  defp opt(prefix, v), do: [prefix <> v]

  defp sum(files, k), do: files |> Enum.map(& &1[k]) |> Enum.sum()

  defp num(s) do
    case Integer.parse(s) do
      {n, _} -> n
      :error -> 0
    end
  end

  defp get(m, k) when is_map(m), do: Map.get(m, k, Map.get(m, Atom.to_string(k)))
  defp get(_, _), do: nil

  defp to_int(nil, d), do: d
  defp to_int(n, _) when is_integer(n), do: n

  defp to_int(s, d) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} -> n
      :error -> d
    end
  end

  defp to_int(_, d), do: d
end