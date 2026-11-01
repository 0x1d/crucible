root = Path.expand("../../functions/memory", __DIR__)

for name <- ~w(transact retract query recall) do
  Code.compile_file(Path.join([root, name, "tool.ex"]))
end

defmodule Runtime.Memory.EntryTest do
  use ExUnit.Case, async: false

  setup do
    path =
      Path.join(System.tmp_dir!(), "alchemist-entry-#{System.unique_integer([:positive])}.graph")

    on_exit(fn ->
      File.rm(path)
      File.rm(path <> ".tx")
    end)
    assert :ok = Runtime.Memory.reset!(path)
    :ok
  end

  test "entries retract a fact and query the earlier transaction" do
    assert {:ok, %{"tx" => 1}} =
             AgentFn.Memory.Transact.run(%{
               "reason" => "Initial choice",
               "facts" => [
                 %{"e" => "decision/db", "a" => "description", "v" => "PostgreSQL"}
               ]
             })

    assert {:ok, %{"tx" => 2}} =
             AgentFn.Memory.Retract.run(%{
               "reason" => "Switching to CockroachDB",
               "facts" => [
                 %{"e" => "decision/db", "a" => "description", "v" => "PostgreSQL"}
               ]
             })

    assert {:ok, _} =
             AgentFn.Memory.Transact.run(%{
               "reason" => "Switching to CockroachDB",
               "facts" => [
                 %{"e" => "decision/db", "a" => "description", "v" => "CockroachDB"}
               ]
             })

    assert {:ok, %{"rows" => [%{"name" => "PostgreSQL"}]}} =
             AgentFn.Memory.Query.run(%{
               "find" => ["name"],
               "as_of" => 1,
               "where" => [
                 %{"e" => "decision/db", "a" => "description", "v" => "?name"}
               ]
             })

    assert {:ok, %{"hits" => [%{"entity" => "decision/db", "description" => "CockroachDB"}]}} =
             AgentFn.Memory.Recall.run(%{"question" => "CockroachDB choice"})
  end

  test "find lists the memory slugs" do
    %{functions: functions} = Runtime.Engine.find("memory.")

    names =
      functions
      |> Enum.map(& &1["name"])
      |> Enum.filter(&String.starts_with?(&1, "memory."))
      |> Enum.sort()

    assert names == [
             "memory.query",
             "memory.recall",
             "memory.remember",
             "memory.retract",
             "memory.transact"
           ]
  end
end
