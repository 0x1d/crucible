defmodule Runtime.ServiceGateway.SchemaTest do
  use ExUnit.Case, async: true

  alias Runtime.ServiceGateway.Schema

  test "accepts matching values" do
    schema = %{
      "type" => "object",
      "required" => ["items"],
      "properties" => %{
        "items" => %{"type" => "array", "items" => %{"type" => "integer", "minimum" => 0}, "maxItems" => 3},
        "label" => %{"type" => ["string", "null"], "enum" => ["a", "b", nil]}
      }
    }

    assert :ok = Schema.validate(%{"items" => [1, 2.0], "label" => nil}, schema)
    assert :ok = Schema.validate("anything", true)
    assert :ok = Schema.validate(%{"x" => 1}, %{})
  end

  test "reports paths for failures" do
    schema = %{
      "type" => "object",
      "required" => ["id"],
      "properties" => %{"tags" => %{"type" => "array", "items" => %{"type" => "string", "pattern" => "^[a-z]+$"}}},
      "additionalProperties" => false
    }

    assert {:error, errors} = Schema.validate(%{"tags" => ["ok", "NO", 3], "extra" => true}, schema)
    assert "$.id: is required" in errors
    assert "$.extra: is not allowed" in errors
    assert Enum.any?(errors, &String.starts_with?(&1, "$.tags[1]: must match"))
    assert Enum.any?(errors, &String.starts_with?(&1, "$.tags[2]: expected string"))
    assert {:error, ["$: no value is allowed"]} = Schema.validate(1, false)
  end

  test "combinators" do
    assert :ok = Schema.validate(5, %{"anyOf" => [%{"type" => "string"}, %{"minimum" => 1}]})
    assert {:error, _} = Schema.validate(5, %{"oneOf" => [%{"type" => "integer"}, %{"minimum" => 1}]})
    assert {:error, _} = Schema.validate(true, %{"type" => "number"})
  end
end
