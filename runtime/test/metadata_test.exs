defmodule Runtime.MetadataTest do
  use ExUnit.Case, async: true

  test "extracts moduledoc and specs from AgentFn.Echo" do
    slug = "echo"
    module = Runtime.Compiler.compile_slug!(slug)
    meta = Runtime.Metadata.extract(module)

    assert is_binary(meta["moduledoc"])
    assert String.contains?(meta["moduledoc"], "echoed")
    assert Enum.any?(meta["specs"], &String.contains?(&1, "run"))
  end
end
