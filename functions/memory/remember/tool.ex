defmodule AgentFn.Memory.Remember do
  @moduledoc """
  Asserts many facts in one call.

  Same contract as `memory.transact`, plus session provenance:

  - `source_session` / `session_id` — optional `ses_…` id. When set, every
    distinct entity `e` in `facts` also gets
    `%{"e" => e, "a" => "source-session", "v" => sid}`. The stamp is skipped
    when that triple is already in `facts` or already current in memory, so
    remembering more facts about an entity in the same session works.
  - Prefer passing the live session from agentkit context so memory →
    journal reverse search works via `memory.by_session`.

  Prefer this slug when persisting a bundle of related facts from chat.
  """
  @behaviour AgentFn.Tool

  alias AgentFn.Memory.{Query, Transact}

  @attr "source-session"

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    sid = session_id(args)
    facts = normalize_facts(Map.get(args, "facts") || Map.get(args, :facts) || [])

    with {:ok, enriched} <- maybe_stamp(facts, sid) do
      forward =
        args
        |> Map.put("facts", enriched)
        |> Map.drop(["source_session", :source_session, "session_id", :session_id])

      case Transact.run(forward) do
        {:ok, result} when is_map(result) ->
          {:ok, Map.put(result, "source_session", sid)}

        other ->
          other
      end
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
        Enum.reduce(["e", "a", "v", "valid_from", "valid_to"], %{}, fn key, acc ->
          case Map.get(fact, key) || Map.get(fact, String.to_atom(key)) do
            nil -> acc
            value -> Map.put(acc, key, value)
          end
        end)

      other ->
        other
    end)
  end

  defp normalize_facts(_), do: []

  defp maybe_stamp(facts, sid) when is_binary(sid) do
    entities =
      facts
      |> Enum.flat_map(fn
        %{"e" => e} when is_binary(e) and e != "" -> [canonical(e)]
        _ -> []
      end)
      |> Enum.uniq()

    in_facts =
      MapSet.new(for %{"e" => e, "a" => @attr, "v" => ^sid} <- facts, do: canonical(e))

    with {:ok, stamped} <- stamped_entities(sid) do
      stamps =
        for e <- entities,
            not MapSet.member?(in_facts, e),
            not MapSet.member?(stamped, e) do
          %{"e" => e, "a" => @attr, "v" => sid}
        end

      {:ok, facts ++ stamps}
    end
  end

  defp maybe_stamp(facts, _sid), do: {:ok, facts}

  # Mirrors the memory binding's canonical id rule (temporal_reasoning
  # SKILL.md): lowercase, keep `_` and `-`, every other character becomes
  # `-`, strip leading/trailing `-`. Memory stores and returns canonical ids,
  # so stamps are compared in that form.
  defp canonical(entity) do
    case String.split(entity, "/", parts: 2) do
      [prefix, slug] ->
        slug =
          slug
          |> String.downcase()
          |> String.replace(~r/[^a-z0-9_-]/u, "-")
          |> String.replace(~r/^-+|-+$/, "")

        String.downcase(String.trim(prefix)) <> "/" <> slug

      _ ->
        entity
    end
  end

  # Entities that already carry this session's stamp (canonical ids).
  defp stamped_entities(sid) do
    case Query.run(%{"where" => [["?e", @attr, sid]], "find" => ["e"]}) do
      {:ok, %{"rows" => rows}} ->
        {:ok, MapSet.new(for %{"e" => e} <- rows, is_binary(e), do: e)}

      {:ok, _} ->
        {:ok, MapSet.new()}

      {:error, _} = error ->
        error
    end
  end
end