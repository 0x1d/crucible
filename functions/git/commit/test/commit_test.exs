defmodule AgentFn.Git.CommitTest do
  use ExUnit.Case, async: true

  import FunctionsTest.Git

  alias AgentFn.Git.Commit

  setup do
    dir = tmp_repo!("git-commit")
    write!(dir, "a.txt", "a\n")
    write!(dir, "b.txt", "b\n")
    commit_all!(dir, "init")
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  describe "committing" do
    test "commits only the listed files", %{dir: dir} do
      write!(dir, "a.txt", "a2\n")
      write!(dir, "b.txt", "b2\n")
      write!(dir, "new.txt", "new\n")

      assert {:ok, result} =
               Commit.run(%{"cwd" => dir, "message" => "feat: a and new", "files" => ["a.txt", "new.txt"]})

      assert result["sha"] == head!(dir)
      assert result["branch"] == "main"
      assert result["pushed"] == false
      assert git!(dir, ["log", "-1", "--format=%s"]) == "feat: a and new"

      committed = git!(dir, ["show", "--name-only", "--format=", "HEAD"]) |> String.split("\n")
      assert Enum.sort(committed) == ["a.txt", "new.txt"]

      # b.txt stays modified and unstaged
      assert git!(dir, ["status", "--porcelain"]) == " M b.txt"
    end

    test "does not commit other files that were already staged", %{dir: dir} do
      write!(dir, "a.txt", "a2\n")
      write!(dir, "b.txt", "b2\n")
      git!(dir, ["add", "b.txt"])

      assert {:ok, _} = Commit.run(%{"cwd" => dir, "message" => "only a", "files" => ["a.txt"]})

      assert git!(dir, ["show", "--name-only", "--format=", "HEAD"]) == "a.txt"
      assert git!(dir, ["diff", "--cached", "--name-only"]) == "b.txt"
    end

    test "commits a tracked file whose status line starts with a space (regression)", %{dir: dir} do
      # ` M a.txt` — a leading-space porcelain line used to be mis-parsed
      write!(dir, "a.txt", "a2\n")
      assert git!(dir, ["status", "--porcelain"]) == " M a.txt"

      assert {:ok, _} = Commit.run(%{"cwd" => dir, "message" => "modify a", "files" => ["a.txt"]})
      assert git!(dir, ["status", "--porcelain"]) == ""
    end

    test "supports a multi-line message", %{dir: dir} do
      write!(dir, "a.txt", "a2\n")
      msg = "feat: subject\n\nBody line one.\nBody line two."

      assert {:ok, _} = Commit.run(%{"cwd" => dir, "message" => msg, "files" => ["a.txt"]})
      assert git!(dir, ["log", "-1", "--format=%B"]) == msg
    end

    test "pushes the branch when push: true", %{dir: dir} do
      remote = Path.join(System.tmp_dir!(), "git-commit-remote-#{System.unique_integer([:positive])}")
      File.mkdir_p!(remote)
      on_exit(fn -> File.rm_rf!(remote) end)
      git!(remote, ["init", "-q", "--bare", "-b", "main"])
      git!(dir, ["remote", "add", "origin", remote])
      git!(dir, ["push", "-q", "origin", "main"])

      write!(dir, "a.txt", "a2\n")

      assert {:ok, result} =
               Commit.run(%{"cwd" => dir, "message" => "pushed", "files" => ["a.txt"], "push" => true})

      assert result["pushed"] == true
      assert result["remote"] == "origin"
      assert git!(remote, ["rev-parse", "main"]) == result["sha"]
    end
  end

  describe "dry_run" do
    test "reports changes without committing", %{dir: dir} do
      before = head!(dir)
      write!(dir, "a.txt", "a2\n")

      assert {:ok, result} =
               Commit.run(%{"cwd" => dir, "message" => "x", "files" => ["a.txt"], "dry_run" => true})

      assert result["dry_run"] == true
      assert result["would_commit"] == true
      assert result["changes"] == [" M a.txt"]
      assert result["conflicts"] == []
      assert head!(dir) == before
      assert git!(dir, ["diff", "--cached", "--name-only"]) == ""
    end
  end

  describe "refusals" do
    test "nothing to commit", %{dir: dir} do
      assert {:error, msg} = Commit.run(%{"cwd" => dir, "message" => "x", "files" => ["a.txt"]})
      assert msg =~ "nothing to commit"
    end

    test "conflict markers in a changed file", %{dir: dir} do
      before = head!(dir)
      write!(dir, "b.txt", "x\n<<<<<<< HEAD\ny\n=======\nz\n>>>>>>> other\n")

      assert {:error, msg} = Commit.run(%{"cwd" => dir, "message" => "x", "files" => ["b.txt"]})
      assert msg =~ "conflict markers in b.txt (lines 2, 6)"
      assert head!(dir) == before
      assert git!(dir, ["diff", "--cached", "--name-only"]) == ""
    end

    test "conflict markers in a new untracked file", %{dir: dir} do
      write!(dir, "new.txt", "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\n")

      assert {:error, msg} = Commit.run(%{"cwd" => dir, "message" => "x", "files" => ["new.txt"]})
      assert msg =~ "conflict markers in new.txt"
    end

    test "a lone ======= line (markdown heading) is not a marker", %{dir: dir} do
      write!(dir, "doc.md", "Title\n=======\n\ntext\n")
      assert {:ok, _} = Commit.run(%{"cwd" => dir, "message" => "doc", "files" => ["doc.md"]})
    end

    test "allow_conflict_markers overrides the marker scan", %{dir: dir} do
      write!(dir, "b.txt", "<<<<<<< HEAD\nkept on purpose\n>>>>>>> x\n")

      assert {:ok, _} =
               Commit.run(%{
                 "cwd" => dir,
                 "message" => "x",
                 "files" => ["b.txt"],
                 "allow_conflict_markers" => true
               })
    end

    test "merge in progress with an unresolved file; index left untouched", %{dir: dir} do
      git!(dir, ["checkout", "-q", "-b", "other"])
      write!(dir, "a.txt", "theirs\n")
      commit_all!(dir, "theirs")
      git!(dir, ["checkout", "-q", "main"])
      write!(dir, "a.txt", "ours\n")
      commit_all!(dir, "ours")
      {_, code} = git(dir, ["merge", "other"])
      assert code != 0

      assert {:error, msg} = Commit.run(%{"cwd" => dir, "message" => "x", "files" => ["a.txt"]})
      assert msg =~ "a merge is in progress"
      assert msg =~ "unresolved conflict: a.txt"

      # still unmerged: git add did not run
      assert git!(dir, ["diff", "--name-only", "--diff-filter=U"]) == "a.txt"
    end
  end

  describe "argument validation" do
    test "requires a message", %{dir: dir} do
      assert {:error, msg} = Commit.run(%{"cwd" => dir, "files" => ["a.txt"]})
      assert msg =~ "message"
      assert {:error, _} = Commit.run(%{"cwd" => dir, "message" => "  ", "files" => ["a.txt"]})
    end

    test "requires a non-empty files list", %{dir: dir} do
      assert {:error, msg} = Commit.run(%{"cwd" => dir, "message" => "x"})
      assert msg =~ "files"
      assert {:error, _} = Commit.run(%{"cwd" => dir, "message" => "x", "files" => []})
      assert {:error, _} = Commit.run(%{"cwd" => dir, "message" => "x", "files" => [""]})
    end

    test "rejects a non-existent cwd" do
      assert {:error, msg} =
               Commit.run(%{"cwd" => "/nonexistent/repo", "message" => "x", "files" => ["a"]})

      assert msg =~ "not a directory"
    end
  end
end
