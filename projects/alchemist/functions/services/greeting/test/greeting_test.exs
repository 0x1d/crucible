defmodule AgentFn.Services.GreetingTest do
  use ExUnit.Case, async: true

  test "greets by name" do
    assert {:ok, %{"message" => "Hello, Ada!", "at" => at}} = AgentFn.Services.Greeting.run(%{"name" => "Ada"})
    assert {:ok, _, _} = DateTime.from_iso8601(at)
  end

  test "requires a name" do
    assert {:error, "name is required"} = AgentFn.Services.Greeting.run(%{})
  end
end
