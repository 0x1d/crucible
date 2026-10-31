defmodule Runtime.Memory.LogTest do
  use ExUnit.Case, async: true

  alias Runtime.Memory.Log

  setup do
    path =
      Path.join(System.tmp_dir!(), "alchemist-log-#{System.unique_integer([:positive])}.log")

    on_exit(fn -> File.rm(path) end)
    {:ok, log} = Log.open(path)
    %{log: log, path: path}
  end

  test "transact then query returns the description", %{log: log} do
    assert {:ok, log, %{"tx" => 1, "count" => 1}} = Log.transact(log, decision("PostgreSQL"))

    assert {:ok, %{"rows" => [%{"name" => "PostgreSQL"}], "count" => 1, "as_of" => nil}} =
             Log.query(log, find_name())
  end

  test "a correction stays visible at the earlier transaction", %{log: log} do
    assert {:ok, log, %{"tx" => 1}} =
             Log.transact(log, decision("PostgreSQL", "Initial choice"))

    assert {:ok, log, _} =
             Log.retract(log, decision("PostgreSQL", "Switching to CockroachDB"))

    assert {:ok, log, %{"tx" => 3}} =
             Log.transact(log, decision("CockroachDB", "Switching to CockroachDB"))

    assert {:ok, %{"rows" => [%{"name" => "PostgreSQL"}]}} =
             Log.query(log, find_name(%{"as_of" => 1}))

    assert {:ok, %{"rows" => []}} = Log.query(log, find_name(%{"as_of" => 2}))

    assert {:ok, %{"rows" => [%{"name" => "CockroachDB"}]}} = Log.query(log, find_name())
  end

  test "valid time and as_of combine", %{log: log} do
    assert {:ok, log, %{"tx" => 1}} =
             Log.transact(log, %{
               "reason" => "recorded TechCorp",
               "facts" => [
                 fact("decision/job", "description", "TechCorp", %{
                   "valid_from" => "2020-01-01",
                   "valid_to" => "2023-06-01"
                 })
               ]
             })

    assert {:ok, log, %{"tx" => 2}} =
             Log.transact(log, %{
               "reason" => "recorded StartupCo",
               "facts" => [
                 fact("decision/job", "description", "StartupCo", %{
                   "valid_from" => "2023-06-01"
                 })
               ]
             })

    assert {:ok, %{"rows" => [%{"name" => "TechCorp"}]}} =
             Log.query(
               log,
               find_description("decision/job", %{"as_of" => 1, "valid_at" => "2021-06-01"})
             )

    assert {:ok, %{"rows" => []}} =
             Log.query(
               log,
               find_description("decision/job", %{"as_of" => 1, "valid_at" => "2024-01-01"})
             )

    assert {:ok, %{"rows" => [%{"name" => "StartupCo"}], "valid_at" => "2024-01-01T00:00:00Z"}} =
             Log.query(
               log,
               find_description("decision/job", %{"as_of" => 2, "valid_at" => "2024-01-01"})
             )

    assert {:ok, %{"rows" => [%{"name" => "TechCorp"}]}} =
             Log.query(
               log,
               find_description("decision/job", %{"valid_at" => "any", "as_of" => 1})
             )
  end

  test "an omitted valid_at hides facts outside now", %{log: log} do
    assert {:ok, log, _} =
             Log.transact(log, %{
               "reason" => "expired and future",
               "facts" => [
                 fact("decision/past", "description", "gone", %{"valid_to" => "2000-01-01"}),
                 fact("decision/future", "description", "later", %{"valid_from" => "2999-01-01"}),
                 fact("decision/now", "description", "current")
               ]
             })

    assert {:ok, %{"rows" => [%{"name" => "current"}]}} =
             Log.query(log, %{
               "find" => ["name"],
               "where" => [%{"e" => "?e", "a" => "description", "v" => "?name"}]
             })
  end

  test "history lists the assert and the retract", %{log: log} do
    assert {:ok, log, _} = Log.transact(log, decision("PostgreSQL", "Initial choice"))
    assert {:ok, log, _} = Log.retract(log, decision("PostgreSQL", "replaced"))

    assert {:ok, %{"rows" => rows, "count" => 2}} =
             Log.query(log, %{
               "history" => true,
               "where" => [%{"e" => "decision/db", "a" => "description", "v" => "?name"}]
             })

    assert Enum.map(rows, & &1["op"]) == ["assert", "retract"]
    assert Enum.map(rows, & &1["v"]) == ["PostgreSQL", "PostgreSQL"]
    assert hd(rows)["reason"] == "Initial choice"
  end

  test "joins follow an entity value", %{log: log} do
    assert {:ok, log, _} =
             Log.transact(log, %{
               "reason" => "link a decision to its motive",
               "facts" => [
                 fact("decision/db", "description", "PostgreSQL"),
                 fact("decision/db", "motivated_by", "decision/latency"),
                 fact("decision/latency", "description", "need low latency")
               ]
             })

    assert {:ok, %{"rows" => [%{"text" => "need low latency"}]}} =
             Log.query(log, %{
               "find" => ["text"],
               "where" => [
                 %{"e" => "decision/db", "a" => "motivated_by", "v" => "?other"},
                 %{"e" => "?other", "a" => "description", "v" => "?text"}
               ]
             })
  end

  test "recall ranks overlapping descriptions and skips unrelated ones", %{log: log} do
    assert {:ok, log, _} = Log.transact(log, decision("PostgreSQL for the ledger"))

    assert {:ok, log, _} =
             Log.transact(log, %{
               "reason" => "unrelated",
               "facts" => [fact("preference/color", "description", "blue widgets")]
             })

    assert {:ok,
            %{
              "hits" => [
                %{"entity" => "decision/db", "description" => "PostgreSQL for the ledger"}
              ]
            }} =
             Log.recall(log, %{"question" => "which ledger database"})

    assert {:ok, %{"hits" => [], "count" => 0}} =
             Log.recall(log, %{"question" => "kubernetes ingress"})
  end

  test "rejects writes that break the schema", %{log: log} do
    assert {:error, "reason is required"} = Log.transact(log, %{"facts" => []})

    assert {:error, "facts must be a non-empty list"} =
             Log.transact(log, %{"reason" => "because", "facts" => []})

    assert {:error, "unknown entity"} =
             Log.transact(log, %{
               "reason" => "because",
               "facts" => [fact("component/api", "description", "edge")]
             })

    assert {:error, "unknown attribute"} =
             Log.transact(log, %{
               "reason" => "because",
               "facts" => [fact("decision/db", "name", "PostgreSQL")]
             })

    assert {:error, "description is required"} =
             Log.transact(log, %{
               "reason" => "because",
               "facts" => [fact("decision/db", "rationale", "fast reads")]
             })

    assert {:error, "value must be an entity"} =
             Log.transact(log, %{
               "reason" => "because",
               "facts" => [
                 fact("decision/db", "description", "PostgreSQL"),
                 fact("decision/db", "depends_on", "not an entity")
               ]
             })
  end

  test "rejects a repeated current fact and a missing retract", %{log: log} do
    assert {:ok, log, _} = Log.transact(log, decision("PostgreSQL"))
    assert {:error, "fact is already current"} = Log.transact(log, decision("PostgreSQL"))

    assert {:error, "fact is not current"} =
             Log.retract(log, decision("CockroachDB", "never stored"))
  end

  test "replays a complete log and ignores a torn trailing line", %{path: path, log: log} do
    assert {:ok, log, _} = Log.transact(log, decision("PostgreSQL"))
    Log.close(log)

    File.write!(path, "{\"tx\":", [:append])
    assert {:ok, reopened} = Log.open(path)
    assert {:ok, %{"rows" => [%{"name" => "PostgreSQL"}]}} = Log.query(reopened, find_name())

    assert {:ok, _reopened, %{"tx" => 2}} =
             Log.transact(reopened, decision("CockroachDB", "next"))
  end

  test "a corrupt complete line fails open", %{path: path, log: log} do
    Log.close(log)
    File.write!(path, "{\"tx\":1,\"broken\":true}\n")
    assert {:error, "invalid memory log line 1"} = Log.open(path)
  end

  test "a gap in transaction numbers fails open", %{path: path, log: log} do
    assert {:ok, log, _} = Log.transact(log, decision("PostgreSQL"))
    Log.close(log)

    File.write!(
      path,
      File.read!(path) <>
        ~s({"tx":3,"at":"2020-01-01T00:00:00Z","reason":"gap","facts":[{"op":"assert","e":"decision/db","a":"description","v":"x","valid_from":null,"valid_to":null}]}\n)
    )

    assert {:error, "memory log tx is not contiguous"} = Log.open(path)
  end

  test "an as_of timestamp excludes later transactions", %{log: log} do
    assert {:ok, log, %{"at" => at}} = Log.transact(log, decision("PostgreSQL"))

    assert {:ok, %{"rows" => []}} =
             Log.query(log, find_name(%{"as_of" => "1999-01-01T00:00:00Z"}))

    assert {:ok, %{"rows" => [%{"name" => "PostgreSQL"}]}} =
             Log.query(log, find_name(%{"as_of" => at}))
  end

  test "query and recall report truncation", %{log: log} do
    facts =
      for n <- 1..201 do
        fact("decision/item_#{n}", "description", "shared ledger item #{n}")
      end

    assert {:ok, log, _} =
             Log.transact(log, %{"reason" => "batch one", "facts" => Enum.take(facts, 100)})

    assert {:ok, log, _} =
             Log.transact(log, %{"reason" => "batch two", "facts" => Enum.slice(facts, 100, 100)})

    assert {:ok, log, _} =
             Log.transact(log, %{"reason" => "batch three", "facts" => Enum.slice(facts, 200, 1)})

    assert {:ok, %{"count" => 200, "truncated" => true}} =
             Log.query(log, %{
               "find" => ["name"],
               "where" => [%{"e" => "?e", "a" => "description", "v" => "?name"}]
             })

    assert {:ok, %{"count" => 20, "truncated" => true}} =
             Log.recall(log, %{"question" => "shared ledger item"})
  end

  defp decision(value, reason \\ "Initial choice") do
    %{"reason" => reason, "facts" => [fact("decision/db", "description", value)]}
  end

  defp fact(entity, attribute, value, extra \\ %{}) do
    Map.merge(%{"e" => entity, "a" => attribute, "v" => value}, extra)
  end

  defp find_name(extra \\ %{}), do: find_description("decision/db", extra)

  defp find_description(entity, extra) do
    Map.merge(
      %{
        "find" => ["?name"],
        "where" => [%{"e" => entity, "a" => "description", "v" => "?name"}]
      },
      extra
    )
  end
end
