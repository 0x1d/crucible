# Codex warm load normally compiles these at app start; compile only what is
# missing so the suite does not redefine live modules.
root = Path.expand("../../functions/memory", __DIR__)

for name <- ~w(transact retract query overview remember by_session),
    not Code.ensure_loaded?(Module.concat([AgentFn.Memory, Macro.camelize(name)])) do
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

    # close mode: retract (tx 2) + re-transact of the closed window (tx 3)
    assert {:ok, %{"tx" => 3, "mode" => "close"}} =
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

    assert {:ok, %{"entities" => ["decision/db"], "count" => 1}} =
             AgentFn.Memory.Overview.run(%{"prefix" => "decision/"})
  end

  test "remember updates an entity already stamped in the same session" do
    sid = "ses_same"

    assert {:ok, %{"entities" => ["decision/db"]}} =
             AgentFn.Memory.Remember.run(%{
               "reason" => "seed",
               "source_session" => sid,
               "facts" => [
                 %{"e" => "decision/db", "a" => "description", "v" => "PostgreSQL"}
               ]
             })

    # Same entity, same session, written with a non-canonical id: no duplicate
    # source-session stamp, so the write is not rejected as already current.
    assert {:ok, %{"count" => 1, "entities" => ["decision/db"]}} =
             AgentFn.Memory.Remember.run(%{
               "reason" => "more detail",
               "source_session" => sid,
               "facts" => [
                 %{"e" => "decision/DB", "a" => "rationale", "v" => "Team runs it"}
               ]
             })

    assert {:ok, %{"entities" => ["decision/db"]}} =
             AgentFn.Memory.BySession.run(%{"session_id" => sid})

    assert {:ok, %{"rows" => [%{"t" => "type/decision"}]}} =
             AgentFn.Memory.Query.run(%{
               "find" => ["t"],
               "where" => [["decision/db", "entity-type", "?t"]]
             })
  end

  test "remember keeps valid-time windows on facts" do
    assert {:ok, _} =
             AgentFn.Memory.Remember.run(%{
               "reason" => "history",
               "source_session" => "ses_hist",
               "facts" => [
                 %{
                   "e" => "decision/cache",
                   "a" => "description",
                   "v" => "Redis",
                   "valid_from" => "2020-01-01",
                   "valid_to" => "2021-01-01"
                 }
               ]
             })

    assert {:ok, %{"rows" => [%{"d" => "Redis"}]}} =
             AgentFn.Memory.Query.run(%{
               "valid_at" => "2020-06-01",
               "find" => ["d"],
               "where" => [["decision/cache", "description", "?d"]]
             })

    assert {:ok, %{"rows" => []}} =
             AgentFn.Memory.Query.run(%{
               "find" => ["d"],
               "where" => [["decision/cache", "description", "?d"]]
             })
  end

  test "find lists the memory slugs" do
    %{functions: functions} = Runtime.Engine.find("memory.")

    names =
      functions
      |> Enum.map(& &1["name"])
      |> Enum.filter(&String.starts_with?(&1, "memory."))
      |> Enum.sort()

    assert names == [
             "memory.by_session",
             "memory.overview",
             "memory.query",
             "memory.remember",
             "memory.retract",
             "memory.transact"
           ]
  end
end
