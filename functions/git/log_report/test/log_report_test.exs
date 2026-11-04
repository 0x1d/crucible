defmodule AgentFn.Git.LogReportTest do
  use ExUnit.Case, async: true

  import FunctionsTest.Git

  alias AgentFn.Git.LogReport

  defp commit(attrs) do
    Map.merge(
      %{
        "sha" => "abcdef1234",
        "short" => "abcdef1",
        "author" => "Ann",
        "date" => "2026-11-03T10:00:00+01:00",
        "subject" => "feat: x",
        "merge" => false,
        "files" => [],
        "added" => 0,
        "deleted" => 0
      },
      attrs
    )
  end

  defp file(path, a, d), do: %{"path" => path, "added" => a, "deleted" => d}

  describe "commit_type/1" do
    test "conventional prefixes, merges, and others" do
      assert LogReport.commit_type(commit(%{"subject" => "feat(tui): x"})) == "feat"
      assert LogReport.commit_type(commit(%{"subject" => "Fix!: breaking"})) == "fix"
      assert LogReport.commit_type(commit(%{"subject" => "TUI (#15)"})) == "other"
      assert LogReport.commit_type(commit(%{"merge" => true, "subject" => "feat: merged"})) == "merge"
    end
  end

  describe "summarize/2" do
    test "totals, authors, types, top files and period across time zones" do
      commits = [
        commit(%{
          "author" => "Bob",
          "subject" => "fix: b",
          # 18:30Z — latest despite the smaller-looking local time string
          "date" => "2026-11-03T19:30:00+01:00",
          "files" => [file("a.ex", 1, 1)],
          "added" => 1,
          "deleted" => 1
        }),
        commit(%{
          "date" => "2026-11-03T18:00:00+00:00",
          "files" => [file("a.ex", 10, 0), file("b.ex", 2, 0)],
          "added" => 12
        }),
        commit(%{"merge" => true, "subject" => "Merge x", "date" => "2026-11-02T08:00:00Z"})
      ]

      s = LogReport.summarize(commits, top_files: 1)

      assert s["totals"] == %{
               "commits" => 3,
               "merges" => 1,
               "files" => 2,
               "added" => 13,
               "deleted" => 1,
               "first" => "2026-11-02T08:00:00Z",
               "last" => "2026-11-03T19:30:00+01:00"
             }

      assert s["authors"] == [%{"name" => "Ann", "count" => 2}, %{"name" => "Bob", "count" => 1}]
      assert Enum.map(s["types"], & &1["name"]) == ["feat", "fix", "merge"]
      assert s["top_files"] == [%{"path" => "a.ex", "commits" => 2, "added" => 11, "deleted" => 1}]
    end

    test "empty input" do
      s = LogReport.summarize([])
      assert s["totals"]["commits"] == 0
      assert s["totals"]["first"] == nil
      assert s["authors"] == [] and s["top_files"] == []
    end
  end

  describe "render/4" do
    test "escapes pipes, marks merges, and shows empty sections" do
      commits = [
        commit(%{"subject" => "feat: a | b", "files" => [file("x|y.ex", 1, 0)], "added" => 1}),
        commit(%{"merge" => true, "short" => "mmmmmmm", "subject" => "Merge"})
      ]

      ctx = %{"cwd" => "/r", "branch" => "main", "ref" => "HEAD", "limit" => 5}
      md = LogReport.render(ctx, commits, LogReport.summarize(commits), nil)

      assert md =~ "# Git change report"
      assert md =~ "- **Scope:** last 5 commits"
      assert md =~ "feat: a \\| b"
      assert md =~ "`x\\|y.ex`"
      assert md =~ "| `mmmmmmm` | 2026-11-03 10:00 | Ann | Merge | merge | +0/-0 |"
      refute md =~ "## Working tree"

      empty = LogReport.render(ctx, [], LogReport.summarize([]), nil)
      assert empty =~ "_no commits in range_"
    end
  end

  describe "run/1" do
    setup do
      dir = tmp_repo!("git-log-report")
      on_exit(fn -> File.rm_rf!(dir) end)
      %{dir: dir}
    end

    test "end-to-end report over a real repo", %{dir: dir} do
      write!(dir, "a.txt", "a\n")
      commit_all!(dir, "feat: add a")
      write!(dir, "a.txt", "a\nb\n")
      commit_all!(dir, "docs: more a")
      write!(dir, "dirty.txt", "x\n")

      assert {:ok, r} = LogReport.run(%{"cwd" => dir, "limit" => 5})

      assert length(r["commits"]) == 2
      assert r["totals"]["commits"] == 2
      assert r["totals"]["added"] == 2
      assert r["working_tree"]["untracked"] == ["dirty.txt"]
      assert r["markdown"] =~ "- **Branch:** `main`"
      assert r["markdown"] =~ "| feat: add a |"
      assert r["markdown"] =~ "- `dirty.txt`"
    end

    test "working_tree: false omits the section and errors pass through", %{dir: dir} do
      write!(dir, "a.txt", "a\n")
      commit_all!(dir, "init")

      assert {:ok, r} = LogReport.run(%{"cwd" => dir, "working_tree" => false})
      assert r["working_tree"] == nil
      refute r["markdown"] =~ "## Working tree"

      assert {:error, "ref must not start with '-'"} = LogReport.run(%{"cwd" => dir, "ref" => "-p"})
    end
  end
end
