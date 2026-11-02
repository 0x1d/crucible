defmodule AgentFn.Sys.CmdTest do
  use ExUnit.Case, async: true

  alias AgentFn.Sys.Cmd

  test "captures stdout, stderr, and exit status separately" do
    assert {:ok, r} = Cmd.run(%{"argv" => ["sh", "-c", "echo out; echo err >&2; exit 3"]})
    assert r["stdout"] == "out\n"
    assert r["stderr"] == "err\n"
    assert r["status"] == 3
  end

  test "merge_stderr interleaves stderr into stdout" do
    assert {:ok, r} =
             Cmd.run(%{"argv" => ["sh", "-c", "echo out; echo err >&2"], "merge_stderr" => true})

    assert r["stdout"] =~ "out"
    assert r["stdout"] =~ "err"
    assert r["stderr"] == ""
  end

  test "argv entries are passed verbatim, never shell-interpolated" do
    tricky = ["$HOME", "a b", "`id`", "; rm -rf /", "\"q\"", "*"]
    assert {:ok, r} = Cmd.run(%{"argv" => ["printf", "%s\\n" | tricky]})
    assert String.split(r["stdout"], "\n", trim: true) == tricky
    assert r["status"] == 0
  end

  test "honours cwd and env" do
    dir = System.tmp_dir!() |> Path.join("sys-cmd-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)

    assert {:ok, r} =
             Cmd.run(%{
               "argv" => ["sh", "-c", "pwd; echo $GREETING"],
               "cwd" => dir,
               "env" => %{"GREETING" => "hi"}
             })

    assert [pwd, "hi"] = String.split(r["stdout"], "\n", trim: true)
    assert Path.basename(pwd) == Path.basename(dir)
  end

  test "times out" do
    assert {:error, "command timed out after 100ms"} =
             Cmd.run(%{"argv" => ["sleep", "5"], "timeout_ms" => 100})
  end

  test "validates arguments" do
    assert {:error, "argv must be a non-empty list"} = Cmd.run(%{"argv" => []})
    assert {:error, "argv entries must be strings"} = Cmd.run(%{"argv" => ["echo", 1]})
    assert {:error, "timeout_ms must be" <> _} = Cmd.run(%{"argv" => ["true"], "timeout_ms" => 0})
    assert {:error, "cwd is not a directory" <> _} = Cmd.run(%{"argv" => ["true"], "cwd" => "/nope/x"})
    assert {:error, "env must be a map"} = Cmd.run(%{"argv" => ["true"], "env" => [1]})

    assert {:error, "executable not found: no-such-exe-xyz"} =
             Cmd.run(%{"argv" => ["no-such-exe-xyz"]})
  end
end

defmodule AgentFn.Sys.CmdCleanupTest do
  # Sync on purpose: capture files are named by OS pid, so any async test
  # calling sys.cmd at the same moment would show up in the glob below.
  # ExUnit runs sync modules only after every async module has finished.
  use ExUnit.Case, async: false

  alias AgentFn.Sys.Cmd

  test "does not leave stderr capture files behind" do
    before = capture_files()
    {:ok, _} = Cmd.run(%{"argv" => ["sh", "-c", "echo err >&2"]})
    assert capture_files() -- before == []
  end

  defp capture_files do
    System.tmp_dir!() |> Path.join("alchemist-sys-cmd-#{System.pid()}-*.err") |> Path.wildcard()
  end
end
