defmodule AgentFn.Memory.BySession do
  @moduledoc """
  Reverse lookup: session id → memory entities.

  Finds entities whose `source-session` attribute equals (or contains) the
  given id, and returns their `description` when present.

  Args:
  - `session_id` / `source_session` (required) — `ses_…` id or substring
  - `exact` — when true (default), require exact `source-session` match;
    when false, substring match on the value
  - `as_of` / `valid_at` — optional temporal args forwarded to `memory.query`
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    sid =
      Map.get(args, "session_id") || Map.get(args, :session_id) ||
        Map.get(args, "source_session") || Map.get(args, :source_session)

    exact? =
      case Map.get(args, "exact") || Map.get(args, :exact) do
        false -> false
        "false" -> false
        0 -> false
        _ -> true
      end

    with :ok <- require_sid(sid),
         {:ok, linked} <- query_links(sid, exact?, args) do
      entities = linked |> Enum.map(& &1["entity"]) |> Enum.uniq() |> Enum.sort()

      descs =
        case descriptions(entities, args) do
          {:ok, map} -> map
          _ -> %{}
        end

      hits =
        Enum.map(entities, fn e ->
          %{
            "entity" => e,
            "description" => Map.get(descs, e),
            "source_session" => sid
          }
        end)

      {:ok,
       %{
         "session_id" => sid,
         "count" => length(hits),
         "entities" => entities,
         "hits" => hits
       }}
    end
  end

  defp require_sid(sid) when is_binary(sid) and sid != "", do: :ok
  defp require_sid(_), do: {:error, "session_id (or source_session) is required"}

  defp query_links(sid, true, args) do
    q = %{
      "where" => [
        %{"e" => "?entity", "a" => "source-session", "v" => sid}
      ],
      "find" => ["entity"]
    }

    case AgentFn.Memory.Query.run(Map.merge(temporal(args), q)) do
      {:ok, %{"rows" => rows}} ->
        {:ok, Enum.map(rows, fn row -> stringify_row(row, "entity") end)}

      {:ok, other} ->
        # some query shapes return results/variables
        {:ok, normalize_results(other, sid)}

      {:error, _} = err ->
        err
    end
  end

  defp query_links(sid, false, args) do
    # Pull all source-session triples and filter in Elixir (MiniGraf
    # predicate helpers are not always available).
    q = %{
      "where" => [
        %{"e" => "?entity", "a" => "source-session", "v" => "?sid"}
      ],
      "find" => ["entity", "sid"]
    }

    case AgentFn.Memory.Query.run(Map.merge(temporal(args), q)) do
      {:ok, %{"rows" => rows}} ->
        hits =
          rows
          |> Enum.map(fn row ->
            %{
              "entity" => row["entity"] || row[:entity],
              "sid" => row["sid"] || row[:sid]
            }
          end)
          |> Enum.filter(fn %{"sid" => v} ->
            is_binary(v) and String.contains?(v, sid)
          end)

        {:ok, hits}

      {:ok, other} ->
        {:ok, normalize_results(other, sid)}

      {:error, _} = err ->
        err
    end
  end

  defp descriptions([], _), do: {:ok, %{}}

  defp descriptions(entities, args) do
    q = %{
      "where" => [
        %{"e" => "?entity", "a" => "description", "v" => "?text"}
      ],
      "find" => ["entity", "text"]
    }

    case AgentFn.Memory.Query.run(Map.merge(temporal(args), q)) do
      {:ok, %{"rows" => rows}} ->
        map =
          rows
          |> Enum.filter(fn row ->
            e = row["entity"] || row[:entity]
            e in entities
          end)
          |> Map.new(fn row ->
            {row["entity"] || row[:entity], row["text"] || row[:text]}
          end)

        {:ok, map}

      other ->
        other
    end
  end

  defp temporal(args) do
    %{}
    |> maybe_put("as_of", Map.get(args, "as_of") || Map.get(args, :as_of))
    |> maybe_put("valid_at", Map.get(args, "valid_at") || Map.get(args, :valid_at))
  end

  defp maybe_put(map, _k, nil), do: map
  defp maybe_put(map, _k, ""), do: map
  defp maybe_put(map, k, v), do: Map.put(map, k, v)

  defp stringify_row(row, key) when is_map(row) do
    %{key => row[key] || row[String.to_atom(key)]}
  end

  defp normalize_results(%{"results" => results}, _sid) when is_list(results) do
    Enum.map(results, fn
      [e] -> %{"entity" => e}
      [e, _] -> %{"entity" => e}
      e when is_binary(e) -> %{"entity" => e}
      _ -> %{"entity" => nil}
    end)
    |> Enum.filter(& &1["entity"])
  end

  defp normalize_results(_, _), do: []
end