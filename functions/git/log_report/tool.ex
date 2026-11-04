defmodule AgentFn.Git.LogReport do
  @moduledoc """
  Summarize recent git changes of a repository as a markdown report.

  Pure composition: commits come from `git.log`, uncommitted state from
  `git.status`. No direct shell calls.

  Report sections: overview totals, commits by type (conventional-commit
  prefix), authors, a commit table, most touched files, and the working tree.

  Args:
  - `cwd` / `repo` — repository directory (default: runtime cwd)
  - `limit` — number of commits (default 10)
  - `since`, `until`, `ref`, `author`, `paths`, `no_merges`, `first_parent` —
    forwarded to `git.log`
  - `working_tree` — include the uncommitted status section (default true)
  - `top_files` — number of most-touched files to list (default 10)

  Returns `markdown` plus structured `commits`, `totals`, `authors`, `types`,
  `top_files`, `working_tree`.
  """

  alias AgentFn.Git.Log
  alias AgentFn.Git.Status

  @log_keys ~w(cwd repo ref since until author paths no_merges first_parent)
  @type args :: %{
    optional(:cwd) => String.t(),
    optional(:limit) => non_neg_integer(),
    optional(:repo) => String.t(),
    optional(:since) => String.t(),
    optional(:top_files) => non_neg_integer()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    cwd = args["cwd"] || args["repo"] || File.cwd!()
    limit = args["limit"] || 10
    log_args = args |> Map.take(@log_keys) |> Map.put("cwd", cwd) |> Map.put("limit", limit)

    with {:ok, log} <- Log.run(log_args) do
      commits = log["commits"]
      summary = summarize(commits, top_files: to_int(args["top_files"], 10))
      wt = if Map.get(args, "working_tree", true) != false, do: working_tree(cwd), else: nil

      ctx = %{
        "cwd" => cwd,
        "branch" => log["branch"],
        "ref" => log["ref"],
        "since" => args["since"],
        "limit" => limit
      }

      {:ok,
       Map.merge(summary, %{
         "markdown" => render(ctx, commits, summary, wt),
         "commits" => commits,
         "working_tree" => wt
       })}
    end
  end

  def run(_), do: {:error, "args must be a map"}

  @doc "Aggregates `git.log` commits into totals, authors, types and top files."
  @spec summarize([map()], keyword()) :: map()
  def summarize(commits, opts \\ []) do
    paths = commits |> Enum.flat_map(& &1["files"]) |> Enum.map(& &1["path"]) |> Enum.uniq()
    by_time = Enum.sort_by(commits, &timestamp(&1["date"]))

    %{
      "totals" => %{
        "commits" => length(commits),
        "merges" => Enum.count(commits, & &1["merge"]),
        "files" => length(paths),
        "added" => commits |> Enum.map(& &1["added"]) |> Enum.sum(),
        "deleted" => commits |> Enum.map(& &1["deleted"]) |> Enum.sum(),
        "first" => by_time |> List.first() |> then(&(&1 && &1["date"])),
        "last" => by_time |> List.last() |> then(&(&1 && &1["date"]))
      },
      "authors" => count_by(commits, & &1["author"]),
      "types" => count_by(commits, &commit_type/1),
      "top_files" => top_files(commits, Keyword.get(opts, :top_files, 10))
    }
  end

  @doc "Conventional-commit type of a commit (`feat`, `fix`, ...), `merge`, or `other`."
  @spec commit_type(map()) :: String.t()
  def commit_type(%{"merge" => true}), do: "merge"

  def commit_type(%{"subject" => subject}) do
    case Regex.run(~r/^([a-zA-Z]+)(\([^)]*\))?!?:/, subject) do
      [_, t | _] -> String.downcase(t)
      _ -> "other"
    end
  end

  @doc "Renders the markdown report from context, commits, summary and working tree (or nil)."
  @spec render(map(), [map()], map(), map() | nil) :: String.t()
  def render(ctx, commits, s, wt) do
    t = s["totals"]

    scope =
      if ctx["since"], do: "since `#{ctx["since"]}` (max #{ctx["limit"]})", else: "last #{ctx["limit"]} commits"

    ref_note = if ctx["ref"] in [nil, "HEAD"], do: "", else: " (log of `#{ctx["ref"]}`)"

    [
      "# Git change report",
      "",
      "- **Repository:** `#{ctx["cwd"]}`",
      "- **Branch:** `#{ctx["branch"]}`" <> ref_note,
      "- **Scope:** #{scope}",
      "- **Period:** #{t["first"] || "–"} → #{t["last"] || "–"}",
      "",
      "## Overview",
      "",
      "| Commits | Merges | Files touched | Lines added | Lines deleted |",
      "|---:|---:|---:|---:|---:|",
      "| #{t["commits"]} | #{t["merges"]} | #{t["files"]} | +#{t["added"]} | -#{t["deleted"]} |",
      "",
      "## By type",
      "",
      bullets(s["types"], &"**#{&1["name"]}**: #{&1["count"]}"),
      "",
      "## Authors",
      "",
      bullets(s["authors"], &"#{&1["name"]}: #{&1["count"]}"),
      "",
      "## Commits",
      "",
      if(commits == [],
        do: "_no commits in range_",
        else: [
          "| Commit | Date | Author | Subject | Files | +/- |",
          "|---|---|---|---|---:|---:|",
          Enum.map(commits, &commit_row/1)
        ]
      ),
      "",
      "## Most touched files",
      "",
      if(s["top_files"] == [],
        do: "_none_",
        else: [
          "| File | Commits | +/- |",
          "|---|---:|---:|",
          Enum.map(s["top_files"], &"| `#{esc(&1["path"])}` | #{&1["commits"]} | +#{&1["added"]}/-#{&1["deleted"]} |")
        ]
      ),
      "",
      render_wt(wt)
    ]
    |> List.flatten()
    |> Enum.join("\n")
    |> String.trim_trailing()
    |> Kernel.<>("\n")
  end

  # ---------- private ----------

  defp commit_row(c) do
    date = c["date"] |> String.slice(0, 16) |> String.replace("T", " ")
    files = if c["merge"], do: "merge", else: length(c["files"])

    "| `#{c["short"]}` | #{date} | #{esc(c["author"])} | #{esc(c["subject"])} | #{files} | +#{c["added"]}/-#{c["deleted"]} |"
  end

  defp timestamp(iso) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} -> DateTime.to_unix(dt)
      _ -> 0
    end
  end

  defp timestamp(_), do: 0

  defp bullets([], _), do: "_none_"
  defp bullets(items, fun), do: Enum.map(items, &("- " <> fun.(&1)))

  defp count_by(commits, fun) do
    commits
    |> Enum.group_by(fun)
    |> Enum.map(fn {k, cs} -> %{"name" => k, "count" => length(cs)} end)
    |> Enum.sort_by(&{-&1["count"], &1["name"]})
  end

  defp top_files(commits, n) do
    commits
    |> Enum.flat_map(& &1["files"])
    |> Enum.group_by(& &1["path"])
    |> Enum.map(fn {path, fs} ->
      %{
        "path" => path,
        "commits" => length(fs),
        "added" => fs |> Enum.map(& &1["added"]) |> Enum.sum(),
        "deleted" => fs |> Enum.map(& &1["deleted"]) |> Enum.sum()
      }
    end)
    |> Enum.sort_by(&{-&1["commits"], -(&1["added"] + &1["deleted"]), &1["path"]})
    |> Enum.take(n)
  end

  defp working_tree(cwd) do
    case Status.run(%{"cwd" => cwd, "untracked" => "normal"}) do
      {:ok, st} ->
        scalars = Map.new(~w(clean ahead behind upstream), &{&1, field(st, &1)})
        lists = Map.new(~w(staged unstaged untracked conflicted), &{&1, field(st, &1) || []})
        Map.merge(scalars, lists)

      {:error, e} ->
        %{"error" => to_string(e)}
    end
  end

  defp render_wt(nil), do: []
  defp render_wt(%{"error" => e}), do: ["## Working tree", "", "_status unavailable: #{e}_"]

  defp render_wt(wt) do
    sync =
      case wt["upstream"] do
        nil -> "no upstream"
        up -> "`#{up}` — ahead #{wt["ahead"] || 0}, behind #{wt["behind"] || 0}"
      end

    groups = [
      {"Staged", wt["staged"]},
      {"Unstaged", wt["unstaged"]},
      {"Untracked", wt["untracked"]},
      {"Conflicted", wt["conflicted"]}
    ]

    state =
      if wt["clean"],
        do: "clean",
        else: Enum.map_join(groups, ", ", fn {l, ps} -> "#{length(ps)} #{String.downcase(l)}" end)

    lists =
      for {label, paths} <- groups, paths != [] do
        shown = Enum.take(paths, 20)
        more = length(paths) - length(shown)

        ["", "**#{label}:**", Enum.map(shown, &"- `#{&1}`")] ++
          if(more > 0, do: ["- … #{more} more"], else: [])
      end

    ["## Working tree", "", "- **Upstream:** #{sync}", "- **State:** " <> state | lists]
  end

  defp esc(s), do: s |> to_string() |> String.replace("|", "\\|")

  # git.status may return string or atom keys
  defp field(m, k) do
    case Map.fetch(m, k) do
      {:ok, v} ->
        v

      :error ->
        Enum.find_value(m, fn {mk, v} -> if is_atom(mk) and Atom.to_string(mk) == k, do: v end)
    end
  end

  defp to_int(n, _) when is_integer(n), do: n

  defp to_int(s, d) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} -> n
      :error -> d
    end
  end

  defp to_int(_, d), do: d
end