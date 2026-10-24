defmodule Runtime.PipelineTest do
  use ExUnit.Case, async: false

  test "pipeline.demo uses deep module and direct Echo.run" do
    slug = "pipeline.demo"
    Runtime.Compiler.compile_slug!(slug)

    assert {:ok, result} =
             AgentFn.Registry.call(slug, %{"input" => "x"})

    assert result["enriched"] == true
    assert result["echoed"] == true
    assert result["composed"] == true
    assert result["input"] == "x"
  end

  test "nested slug resolves module AgentFn.Pipeline.Demo" do
    assert Runtime.Registry.module_name("pipeline.demo") == AgentFn.Pipeline.Demo
  end
end
