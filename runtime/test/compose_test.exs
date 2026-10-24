defmodule Runtime.ComposeTest do
  use ExUnit.Case, async: false

  test "pipeline.demo composes deep module and echo registry call" do
    slug = "pipeline.demo"
    Runtime.Compiler.compile_slug!(slug)

    assert {:ok, result} =
             AgentFn.Registry.call(slug, %{"input" => "x"})

    assert result["enriched"] == true
    assert result["echoed"] == true
    assert result["composed"] == true
    assert result["input"] == "x"
  end

  test "AgentFn.Compose.pipeline chains tools" do
    Runtime.Compiler.compile_slug!("echo")
    Runtime.Compiler.compile_slug!("pipeline.demo")

    assert {:ok, result} =
             AgentFn.Compose.pipeline(%{"n" => 1}, ["echo", "echo"])

    assert result["echoed"] == true
    assert result["n"] == 1
  end

  test "nested slug resolves module AgentFn.Pipeline.Demo" do
    assert Runtime.Registry.module_name("pipeline.demo") == AgentFn.Pipeline.Demo
  end
end
