defmodule AgentFn.Git.LogTest do
  use ExUnit.Case, async: true

  import FunctionsTest.Git

  alias AgentFn.Git.Log

  setup do
    dir = tmp_repo!("git-log")
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  describe "run/1" do
    test "returns commits newest first with numstat", %{dir: dir} do
      write!(dir, "a.txt", "1\n2\n")
      commit_all!(dir, "feat: add a")
      write!(dir, "a.txt", "1\n")
      write!(dir, "b.txt", "b\n")
      commit_all!(dir, "fix(a): trim a")

      assert {:ok, %{"commits" => [second, first], "count" => 2, "branch" => "main"}} =
               Log.run(%{"cwd" => dir})

      assert first["subject"] == "feat: add a"
      assert first["author"] == "Test"
      assert first["email"] == "test@example.com"
      assert first["parents"] == []
      assert first["merge"] == false
      assert [%{"path" => "a.txt", "added" => 2, "deleted" => 0, "binary" => false}] = first["files"]

      assert second["sha"] == head!(dir)
      assert String.starts_with?(second["sha"], second["short"])
      assert {second["added"], second["deleted"]} == {1, 1}
      assert second["files"] |> Enum.map(& &1["path"]) |> Enum.sort() == ["a.txt", "b.txt"]
      assert {:ok, _, _} = DateTime.from_iso8601(second["date"])
    end

    test "keeps multi-line bodies and separator-like characters intact", %{dir: dir} do
      write!(dir, "a.txt", "a\n")
      msg = "feat: tabs\there | pipes => arrows\n\nBody line 1\n\n1\t2\tfake.txt"
      git!(dir, ["add", "-A"])
      git!(dir, ["commit", "-q", "-m", msg])

      assert {:ok, %{"commits" => [c]}} = Log.run(%{"cwd" => dir})
      assert c["subject"] == "feat: tabs\there | pipes => arrows"
      assert c["body"] == "Body line 1\n\n1\t2\tfake.txt"
      assert Enum.map(c["files"], & &1["path"]) == ["a.txt"]
    end

    test "limit, paths, numstat: false", %{dir: dir} do
      for n <- 1..3 do
        write!(dir, "f#{n}.txt", "#{n}\n")
        commit_all!(dir, "c#{n}")
      end

      assert {:ok, %{"count" => 2}} = Log.run(%{"cwd" => dir, "limit" => 2})
      assert {:ok, %{"commits" => [c]}} = Log.run(%{"cwd" => dir, "paths" => ["f1.txt"]})
      assert c["subject"] == "c1"
      assert {:ok, %{"commits" => cs}} = Log.run(%{"cwd" => dir, "numstat" => false})
      assert Enum.all?(cs, &(&1["files"] == []))
    end

    test "marks merge commits and supports no_merges", %{dir: dir} do
      write!(dir, "a.txt", "a\n")
      commit_all!(dir, "init")
      git!(dir, ["checkout", "-q", "-b", "topic"])
      write!(dir, "t.txt", "t\n")
      commit_all!(dir, "topic work")
      git!(dir, ["checkout", "-q", "main"])
      write!(dir, "m.txt", "m\n")
      commit_all!(dir, "main work")
      git!(dir, ["merge", "-q", "--no-ff", "-m", "Merge topic", "topic"])

      assert {:ok, %{"commits" => [merge | _]}} = Log.run(%{"cwd" => dir})
      assert merge["merge"] == true
      assert length(merge["parents"]) == 2
      assert merge["files"] == []

      assert {:ok, %{"commits" => cs}} = Log.run(%{"cwd" => dir, "no_merges" => true})
      refute Enum.any?(cs, & &1["merge"])
      assert length(cs) == 3
    end

    test "reports renames with orig_path", %{dir: dir} do
      write!(dir, "src/old.txt", "same content\n")
      commit_all!(dir, "init")
      git!(dir, ["mv", "src/old.txt", "src/new.txt"])
      git!(dir, ["commit", "-q", "-m", "rename"])

      assert {:ok, %{"commits" => [c | _]}} = Log.run(%{"cwd" => dir, "limit" => 1})
      assert [%{"path" => "src/new.txt", "orig_path" => "src/old.txt"}] = c["files"]
    end

    test "empty range returns no commits", %{dir: dir} do
      write!(dir, "a.txt", "a\n")
      commit_all!(dir, "init")
      assert {:ok, %{"commits" => [], "count" => 0}} = Log.run(%{"cwd" => dir, "ref" => "HEAD..HEAD"})
    end
  end

  describe "validation" do
    test "rejects option-like values", %{dir: dir} do
      assert {:error, "ref must not start with '-'"} = Log.run(%{"cwd" => dir, "ref" => "--all"})
      assert {:error, "since must not start with '-'"} = Log.run(%{"cwd" => dir, "since" => "-x"})
      assert {:error, "author must not start with '-'"} = Log.run(%{"cwd" => dir, "author" => "--exec"})
      assert {:error, "paths must be a list of strings"} = Log.run(%{"cwd" => dir, "paths" => [1]})
    end

    test "errors outside a repository" do
      dir = Path.join(System.tmp_dir!(), "not-a-repo-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      on_exit(fn -> File.rm_rf!(dir) end)
      assert {:error, msg} = Log.run(%{"cwd" => dir})
      assert msg =~ "git rev-parse failed"
    end
  end

  describe "expand_rename/1" do
    test "plain, brace and one-sided brace forms" do
      assert Log.expand_rename("a.txt") == {"a.txt", nil}
      assert Log.expand_rename("old.txt => new.txt") == {"new.txt", "old.txt"}
      assert Log.expand_rename("tui/{a.ts => b.ts}") == {"tui/b.ts", "tui/a.ts"}
      assert Log.expand_rename("src/{x => y}/f.ex") == {"src/y/f.ex", "src/x/f.ex"}
      assert Log.expand_rename("src/{ => sub}/f.ex") == {"src/sub/f.ex", "src/f.ex"}
      assert Log.expand_rename("{lib => }/f.ex") == {"f.ex", "lib/f.ex"}
    end
  end

  test "parse_numstat/1 handles binary files" do
    assert [%{"path" => "img.png", "added" => 0, "deleted" => 0, "binary" => true}] =
             Log.parse_numstat("-\t-\timg.png\n")
  end
end
