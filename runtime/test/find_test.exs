defmodule Runtime.FindTest do
  use ExUnit.Case, async: true

  test "find returns slim summaries by default" do
    found = Runtime.Engine.find("echo", %{})

    assert found[:ok] == true
    assert found[:detail] == false
    assert found[:limit] == 12
    echo = Enum.find(found[:functions], &(&1["name"] == "echo"))
    assert echo
    assert is_binary(echo["summary"])
    refute Map.has_key?(echo, "moduledoc")
  end

  test "find with detail returns full metadata" do
    found = Runtime.Engine.find("echo", %{"detail" => true})

    assert found[:detail] == true
    echo = Enum.find(found[:functions], &(&1["name"] == "echo"))
    assert echo
    assert Map.has_key?(echo, "moduledoc")
    assert Map.has_key?(echo, "specs")
  end

  test "find respects limit and sets truncated" do
    found = Runtime.Engine.find("e", %{"limit" => 1})

    assert found[:count] == 1
    assert found[:truncated] == true
  end
end
