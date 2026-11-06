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
    assert echo["specs"] == ["@spec run(args()) :: {:ok, map()}"]
    refute Map.has_key?(echo, "moduledoc")
  end

  test "find with detail returns full metadata for one exact slug" do
    found = Runtime.Engine.find("echo", %{"detail" => true})

    assert found[:detail] == true
    assert found[:name] == "echo"
    assert found[:count] == 1
    echo = found[:function] || hd(found[:functions])
    assert echo["name"] == "echo"
    assert Map.has_key?(echo, "moduledoc")
    assert Map.has_key?(echo, "specs")
  end

  test "find with detail does not treat substring queries as multi-hit describe" do
    search = Runtime.Engine.find("e", %{"limit" => 3})
    assert search[:ok] == true
    assert search[:count] >= 1
    refute search[:detail]

    found = Runtime.Engine.find("e", %{"detail" => true})

    assert found[:ok] == false
    refute Map.has_key?(found, :functions)
  end

  test "find with detail rejects unknown slug" do
    found = Runtime.Engine.find("not.a.real.slug.xyz", %{"detail" => true})

    assert found[:ok] == false
    assert found[:error] =~ "no entry named"
  end

  test "find respects limit and sets truncated" do
    found = Runtime.Engine.find("e", %{"limit" => 1})

    assert found[:count] == 1
    assert found[:truncated] == true
  end
end
