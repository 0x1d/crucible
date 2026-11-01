defmodule AgentFn.Memory.Remember do
  @moduledoc """
  Asserts many facts in one call.

  Same contract as `memory.transact`, plus session provenance:

  - `source_session` / `session_id` — optional `ses_…` id. When set, every
    distinct entity `e` in `facts` also gets
    `%{"e" => e, "a" => "source_session", "v" => sid}` (skipped if that
    exact triple is already in `facts`).
  - Prefer passing the live session from agentkit context so memory →
    journal reverse search works via `memory.by_session`.

  Prefer this slug when persisting a bundle of related facts from chat.
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    sid = session_id(args)
    facts = normalize_facts(Map.get(args, "facts") || Map.get(args, :facts) || [])

    enriched =
      if is_binary(sid) and sid != "" do
        stamp_source_session(facts, sid)
      else
        facts
      end

    forward =
      args
      |> Map.put("facts", enriched)
      |> Map.drop(["source_session", :source_session, "session_id", :session_id])

    case AgentFn.Memory.Transact.run(forward) do
      {:ok, result} when is_map(result) ->
        {:ok, Map.put(result, "source_session", sid)}

      other ->
        other
    end
  end

  defp session_id(args) do
    case Map.get(args, "source_session") || Map.get(args, :source_session) ||
           Map.get(args, "session_id") || Map.get(args, :session_id) do
      sid when is_binary(sid) and sid != "" -> sid
      _ -> nil
    end
  end

  defp normalize_facts(facts) when is_list(facts) do
    Enum.map(facts, fn
      %{} = fact ->
        %{
          "e" => Map.get(fact, "e") || Map.get(fact, :e),
          "a" => Map.get(fact, "a") || Map.get(fact, :a),
          "v" => Map.get(fact, "v") || Map.get(fact, :v)
        }

      other ->
        other
    end)
  end

  defp normalize_facts(_), do: []

  defp stamp_source_session(facts, sid) do
    entities =
      facts
      |> Enum.flat_map(fn
        %{"e" => e} when is_binary(e) and e != "" -> [e]
        _ -> []
      end)
      |> Enum.uniq()

    existing =
      MapSet.new(
        for %{"e" => e, "a" => "source_session", "v" => ^sid} <- facts, do: e
      )

    stamps =
      for e <- entities, not MapSet.member?(existing, e) do
        %{"e" => e, "a" => "source_session", "v" => sid}
      end

    facts ++ stamps
  end
end