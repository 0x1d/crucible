defmodule AgentFn.ExploreTest do
  use ExUnit.Case, async: true

  alias AgentFn.Explore

  test "defaults repo to parent of File.cwd! without crashing" do
    assert {:ok, %{"profile" => "repo", "branch" => branch}} =
             Explore.run(%{"profile" => "repo", "limit" => 2, "recall_memory" => false})

    # nil on a detached HEAD, as in a pull request checkout in CI
    assert is_nil(branch) or (is_binary(branch) and branch != "")
  end

  @tag :tmp_dir
  test "repo profile reports a detached HEAD as nil branch", %{tmp_dir: dir} do
    git = fn args -> {_, 0} = System.cmd("git", ["-C", dir | args], stderr_to_stdout: true) end
    git.(["init", "--quiet"])
    git.(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "init"])
    git.(["checkout", "--quiet", "--detach"])

    assert {:ok, %{"branch" => nil, "log_lines" => [_]}} =
             Explore.run(%{"profile" => "repo", "repo" => dir, "limit" => 2})
  end

  test "memory profile does not require cwd" do
    assert {:ok, %{"profile" => "memory", "entities" => ents}} =
             Explore.run(%{"profile" => "memory", "limit" => 2})

    assert is_list(ents)
  end

  test "code profile requires query" do
    assert {:error, msg} = Explore.run(%{"profile" => "code"})
    assert msg =~ "query"
  end
end
