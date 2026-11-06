defmodule AgentFn.ExploreTest do
  use ExUnit.Case, async: true

  alias AgentFn.Explore

  test "defaults repo to parent of File.cwd! without crashing" do
    assert {:ok, %{"profile" => "repo", "branch" => branch}} =
             Explore.run(%{"profile" => "repo", "limit" => 2, "recall_memory" => false})

    assert is_binary(branch) and branch != ""
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
