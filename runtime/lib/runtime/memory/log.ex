defmodule Runtime.Memory.Log do
  @moduledoc """
  Append-only belief-graph log and the query over a replayed fact list.

  `Runtime.Memory` owns the live file. This module is the pure log.
  """

  @max_reason 2000
  @max_question 2000
  @max_value 4000
  @max_facts 100
  @max_rows 200
  @max_hits 20
  @entity ~r/^(decision|preference|constraint|dependency)\/[a-z0-9][a-z0-9_-]*$/
  @variable ~r/^\?[a-z][a-z0-9_]*$/
  @var_name ~r/^[a-z][a-z0-9_]*$/
  @attributes ~w(description rationale depends_on motivated_by)
  @edges ~w(depends_on motivated_by)

  defstruct [:path, :device, next_tx: 1, facts: []]

  @type t :: %__MODULE__{
          path: String.t(),
          device: IO.device(),
          next_tx: pos_integer(),
          facts: [map()]
        }

  @spec open(String.t()) :: {:ok, t()} | {:error, String.t()}
  def open(path) when is_binary(path) do
    with :ok <- mkdir(path),
         {:ok, facts} <- replay(path),
         {:ok, device} <- File.open(path, [:append, :binary]) do
      next =
        case facts do
          [] -> 1
          _ -> Enum.max_by(facts, & &1.tx).tx + 1
        end

      {:ok, %__MODULE__{path: path, device: device, next_tx: next, facts: facts}}
    end
  end

  @spec close(t()) :: :ok
  def close(%__MODULE__{device: device}) do
    if is_pid(device) or is_port(device) or is_reference(device) do
      _ = File.close(device)
    end

    :ok
  end

  @spec transact(t(), map()) :: {:ok, t(), map()} | {:error, String.t()}
  def transact(%__MODULE__{} = state, attrs) when is_map(attrs) do
    write(state, attrs, "assert")
  end

  @spec retract(t(), map()) :: {:ok, t(), map()} | {:error, String.t()}
  def retract(%__MODULE__{} = state, attrs) when is_map(attrs) do
    write(state, attrs, "retract")
  end

  @spec query(t(), map()) :: {:ok, map()} | {:error, String.t()}
  def query(%__MODULE__{} = state, attrs) when is_map(attrs) do
    with {:ok, history} <- parse_history(attrs),
         {:ok, as_of} <- parse_as_of(attrs),
         {:ok, valid_at} <- parse_valid_at(attrs),
         {:ok, clauses} <- parse_where(attrs),
         {:ok, find} <- parse_find(attrs, clauses, history) do
      visible = visible_facts(state.facts, as_of, valid_at, history)

      rows =
        if history, do: history_rows(visible, clauses), else: join_rows(visible, clauses, find)

      truncated = length(rows) > @max_rows
      kept = Enum.take(rows, @max_rows)

      {:ok,
       %{
         "rows" => kept,
         "count" => length(kept),
         "truncated" => truncated,
         "as_of" => echo_as_of(as_of),
         "valid_at" => echo_valid(valid_at)
       }}
    end
  end

  @spec recall(t(), map()) :: {:ok, map()} | {:error, String.t()}
  def recall(%__MODULE__{} = state, attrs) when is_map(attrs) do
    with {:ok, question} <- parse_question(attrs) do
      now = now_iso()
      asked = tokenize(question)

      hits =
        state.facts
        |> visible_facts(:latest, {:at, now}, false)
        |> Enum.group_by(& &1.e)
        |> Enum.flat_map(fn {entity, facts} -> score_entity(entity, facts, asked) end)
        |> Enum.sort_by(fn hit -> {-hit["score"], hit["entity"]} end)

      truncated = length(hits) > @max_hits
      kept = Enum.take(hits, @max_hits)
      {:ok, %{"hits" => kept, "count" => length(kept), "truncated" => truncated}}
    end
  end

  defp write(state, attrs, op) do
    with {:ok, reason} <- parse_reason(attrs),
         {:ok, facts} <- parse_facts(attrs, op),
         :ok <- check_batch(state.facts, facts, op) do
      at = now_iso()
      tx = state.next_tx
      stamped = Enum.map(facts, &Map.merge(&1, %{tx: tx, at: at, reason: reason, op: op}))

      line = %{
        "tx" => tx,
        "at" => at,
        "reason" => reason,
        "facts" => Enum.map(stamped, &fact_to_json/1)
      }

      case append_line(state.device, line) do
        :ok ->
          result = %{"tx" => tx, "at" => at, "reason" => reason, "count" => length(stamped)}
          {:ok, %{state | next_tx: tx + 1, facts: state.facts ++ stamped}, result}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp check_batch(existing, facts, "assert") do
    current = net_asserted(existing)

    with :ok <- require_descriptions(facts, current),
         :ok <- reject_current(facts, current) do
      :ok
    end
  end

  defp check_batch(existing, facts, "retract") do
    require_current(facts, net_asserted(existing))
  end

  defp require_descriptions(facts, current) do
    described =
      current
      |> Enum.filter(&(&1.a == "description"))
      |> MapSet.new(& &1.e)

    facts
    |> Enum.map(& &1.e)
    |> Enum.uniq()
    |> Enum.reduce_while(:ok, fn entity, :ok ->
      fresh = Enum.any?(facts, &(&1.e == entity and &1.a == "description"))

      if fresh or MapSet.member?(described, entity) do
        {:cont, :ok}
      else
        {:halt, {:error, "description is required"}}
      end
    end)
  end

  defp reject_current(facts, current) do
    Enum.reduce_while(facts, current, fn fact, acc ->
      if Enum.any?(acc, &(identity(&1) == identity(fact))) do
        {:halt, {:error, "fact is already current"}}
      else
        {:cont, [fact | acc]}
      end
    end)
    |> case do
      {:error, _} = err -> err
      _ -> :ok
    end
  end

  defp require_current(facts, current) do
    Enum.reduce_while(facts, current, fn fact, acc ->
      if Enum.any?(acc, &(identity(&1) == identity(fact))) do
        {:cont, Enum.reject(acc, &(identity(&1) == identity(fact)))}
      else
        {:halt, {:error, "fact is not current"}}
      end
    end)
    |> case do
      {:error, _} = err -> err
      _ -> :ok
    end
  end

  defp visible_facts(facts, as_of, valid_at, history) do
    window = Enum.filter(facts, &in_as_of?(&1, as_of))
    net = if history, do: window, else: net_asserted(window)
    Enum.filter(net, &in_valid?(&1, valid_at))
  end

  defp net_asserted(facts) do
    retracts =
      facts
      |> Enum.filter(&(&1.op == "retract"))
      |> Enum.group_by(&identity/1, & &1.tx)

    Enum.filter(facts, fn
      %{op: "retract"} ->
        false

      %{op: "assert"} = fact ->
        not Enum.any?(Map.get(retracts, identity(fact), []), &(&1 > fact.tx))
    end)
  end

  defp in_as_of?(_fact, :latest), do: true
  defp in_as_of?(fact, {:tx, n}), do: fact.tx <= n
  defp in_as_of?(fact, {:at, at}), do: fact.at <= at

  defp in_valid?(_fact, :any), do: true

  defp in_valid?(fact, {:at, at}) do
    (is_nil(fact.valid_from) or fact.valid_from <= at) and
      (is_nil(fact.valid_to) or fact.valid_to > at)
  end

  defp join_rows(facts, clauses, find) do
    clauses
    |> Enum.reduce([%{}], fn clause, bindings ->
      Enum.flat_map(bindings, fn binding ->
        Enum.flat_map(facts, fn fact ->
          case unify(binding, clause, fact) do
            {:ok, bound} -> [bound]
            :error -> []
          end
        end)
      end)
    end)
    |> Enum.map(fn binding -> Map.new(find, fn var -> {var, Map.fetch!(binding, var)} end) end)
    |> Enum.sort()
    |> Enum.uniq()
  end

  defp history_rows(facts, clauses) do
    facts
    |> Enum.filter(fn fact ->
      Enum.reduce_while(clauses, %{}, fn clause, binding ->
        case unify(binding, clause, fact) do
          {:ok, bound} -> {:cont, bound}
          :error -> {:halt, :error}
        end
      end) != :error
    end)
    |> Enum.map(&history_row/1)
    |> Enum.sort_by(fn row ->
      {row["tx"], row["op"], row["e"], row["a"], row["v"], row["valid_from"], row["valid_to"]}
    end)
  end

  defp history_row(fact) do
    %{
      "tx" => fact.tx,
      "op" => fact.op,
      "at" => fact.at,
      "reason" => fact.reason,
      "e" => fact.e,
      "a" => fact.a,
      "v" => fact.v,
      "valid_from" => fact.valid_from,
      "valid_to" => fact.valid_to
    }
  end

  defp unify(binding, clause, fact) do
    with {:ok, binding} <- bind(binding, clause.e, fact.e),
         {:ok, binding} <- bind(binding, clause.a, fact.a),
         {:ok, binding} <- bind(binding, clause.v, fact.v) do
      {:ok, binding}
    end
  end

  defp bind(binding, "?" <> name, value) do
    case Map.fetch(binding, name) do
      :error -> {:ok, Map.put(binding, name, value)}
      {:ok, ^value} -> {:ok, binding}
      {:ok, _} -> :error
    end
  end

  defp bind(binding, literal, value) when literal == value, do: {:ok, binding}
  defp bind(_binding, _literal, _value), do: :error

  defp score_entity(entity, facts, asked) do
    descriptions = values(facts, "description")

    case descriptions do
      [] ->
        []

      _ ->
        rationales = values(facts, "rationale")
        bag = tokenize(Enum.join([entity | descriptions ++ rationales], " "))
        score = MapSet.size(MapSet.intersection(asked, bag))

        if score == 0 do
          []
        else
          description = best_description(descriptions, asked)
          [hit(entity, description, score, facts)]
        end
    end
  end

  defp best_description(descriptions, asked) do
    descriptions
    |> Enum.sort_by(fn value ->
      {-MapSet.size(MapSet.intersection(asked, tokenize(value))), value}
    end)
    |> hd()
  end

  defp hit(entity, description, score, facts) do
    attributes =
      facts
      |> Enum.group_by(& &1.a, & &1.v)
      |> Enum.flat_map(fn
        {"description", values} ->
          rest = values |> Enum.uniq() |> Enum.sort() |> List.delete(description)
          if rest == [], do: [], else: [{"description", rest}]

        {attribute, values} ->
          [{attribute, values |> Enum.uniq() |> Enum.sort()}]
      end)
      |> Map.new()

    %{
      "entity" => entity,
      "description" => description,
      "score" => score,
      "attributes" => attributes
    }
  end

  defp values(facts, attribute) do
    facts |> Enum.filter(&(&1.a == attribute)) |> Enum.map(& &1.v) |> Enum.uniq()
  end

  defp tokenize(text) do
    ~r/[a-z0-9]{4,}/
    |> Regex.scan(String.downcase(text))
    |> MapSet.new(fn [token] -> token end)
  end

  defp parse_reason(attrs) do
    case Map.get(attrs, "reason") do
      reason when is_binary(reason) ->
        trimmed = String.trim(reason)

        cond do
          trimmed == "" -> {:error, "reason is required"}
          String.length(trimmed) > @max_reason -> {:error, "reason is too long"}
          not String.valid?(trimmed) -> {:error, "reason is required"}
          true -> {:ok, trimmed}
        end

      _ ->
        {:error, "reason is required"}
    end
  end

  defp parse_question(attrs) do
    case Map.get(attrs, "question") do
      question when is_binary(question) ->
        trimmed = String.trim(question)

        cond do
          trimmed == "" -> {:error, "question is required"}
          String.length(trimmed) > @max_question -> {:error, "question is too long"}
          true -> {:ok, trimmed}
        end

      _ ->
        {:error, "question is required"}
    end
  end

  defp parse_facts(attrs, op) do
    case Map.get(attrs, "facts") do
      facts when is_list(facts) and facts != [] ->
        if length(facts) > @max_facts do
          {:error, "too many facts"}
        else
          facts
          |> Enum.reduce_while({:ok, []}, fn fact, {:ok, acc} ->
            case parse_fact(fact, op) do
              {:ok, parsed} -> {:cont, {:ok, [parsed | acc]}}
              {:error, _} = err -> {:halt, err}
            end
          end)
          |> case do
            {:ok, rev} -> {:ok, Enum.reverse(rev)}
            err -> err
          end
        end

      _ ->
        {:error, "facts must be a non-empty list"}
    end
  end

  defp parse_fact(fact, _op) when not is_map(fact), do: {:error, "unknown entity"}

  defp parse_fact(fact, op) do
    with {:ok, entity} <- parse_entity(Map.get(fact, "e")),
         {:ok, attribute} <- parse_attribute(Map.get(fact, "a")),
         {:ok, value} <- parse_value(Map.get(fact, "v"), attribute),
         {:ok, valid_from} <- parse_optional_time(Map.get(fact, "valid_from")),
         {:ok, valid_to} <- parse_optional_time(Map.get(fact, "valid_to")),
         :ok <- time_order(valid_from, valid_to) do
      {:ok,
       %{
         op: op,
         e: entity,
         a: attribute,
         v: value,
         valid_from: valid_from,
         valid_to: valid_to
       }}
    end
  end

  defp parse_entity(entity) when is_binary(entity) do
    if Regex.match?(@entity, entity), do: {:ok, entity}, else: {:error, "unknown entity"}
  end

  defp parse_entity(_), do: {:error, "unknown entity"}

  defp parse_attribute(attribute) when attribute in @attributes, do: {:ok, attribute}
  defp parse_attribute(_), do: {:error, "unknown attribute"}

  defp parse_value(value, _attribute) when not is_binary(value),
    do: {:error, "value must be a string"}

  defp parse_value("", _attribute), do: {:error, "value must be a string"}

  defp parse_value(value, attribute) do
    cond do
      not String.valid?(value) ->
        {:error, "value must be a string"}

      String.length(value) > @max_value ->
        {:error, "value is too long"}

      attribute in @edges and not Regex.match?(@entity, value) ->
        {:error, "value must be an entity"}

      true ->
        {:ok, value}
    end
  end

  defp parse_optional_time(nil), do: {:ok, nil}

  defp parse_optional_time(value) when is_binary(value) do
    case parse_timestamp(value) do
      {:ok, timestamp} -> {:ok, timestamp}
      :error -> {:error, "invalid timestamp"}
    end
  end

  defp parse_optional_time(_), do: {:error, "invalid timestamp"}

  defp time_order(from, to) when is_binary(from) and is_binary(to) and from >= to do
    {:error, "valid_from must be before valid_to"}
  end

  defp time_order(_from, _to), do: :ok

  defp parse_history(attrs) do
    case Map.get(attrs, "history") do
      nil -> {:ok, false}
      value when is_boolean(value) -> {:ok, value}
      _ -> {:error, "history must be a boolean"}
    end
  end

  defp parse_as_of(attrs) do
    case Map.get(attrs, "as_of") do
      nil ->
        {:ok, :latest}

      n when is_integer(n) and n >= 0 ->
        {:ok, {:tx, n}}

      n when is_binary(n) ->
        case parse_timestamp(n) do
          {:ok, timestamp} -> {:ok, {:at, timestamp}}
          :error -> {:error, "invalid as_of"}
        end

      _ ->
        {:error, "invalid as_of"}
    end
  end

  defp parse_valid_at(attrs) do
    case Map.get(attrs, "valid_at") do
      nil ->
        {:ok, {:at, now_iso()}}

      "any" ->
        {:ok, :any}

      value when is_binary(value) ->
        case parse_timestamp(value) do
          {:ok, timestamp} -> {:ok, {:at, timestamp}}
          :error -> {:error, "invalid timestamp"}
        end

      _ ->
        {:error, "invalid timestamp"}
    end
  end

  defp parse_where(attrs) do
    case Map.get(attrs, "where") do
      clauses when is_list(clauses) and clauses != [] ->
        clauses
        |> Enum.reduce_while({:ok, []}, fn clause, {:ok, acc} ->
          case parse_clause(clause) do
            {:ok, parsed} -> {:cont, {:ok, [parsed | acc]}}
            {:error, _} = err -> {:halt, err}
          end
        end)
        |> case do
          {:ok, rev} -> {:ok, Enum.reverse(rev)}
          err -> err
        end

      _ ->
        {:error, "where must be a non-empty list"}
    end
  end

  defp parse_clause(clause) when not is_map(clause), do: {:error, "unknown entity"}

  defp parse_clause(clause) do
    with {:ok, entity} <- parse_pattern(Map.get(clause, "e"), :entity),
         {:ok, attribute} <- parse_pattern(Map.get(clause, "a"), :attribute),
         {:ok, value} <- parse_pattern(Map.get(clause, "v"), :value) do
      {:ok, %{e: entity, a: attribute, v: value}}
    end
  end

  defp parse_pattern("?" <> _ = variable, _kind) do
    if Regex.match?(@variable, variable),
      do: {:ok, variable},
      else: {:error, "unbound find variable"}
  end

  defp parse_pattern(value, :entity) do
    case parse_entity(value) do
      {:ok, entity} -> {:ok, entity}
      _ -> {:error, "unknown entity"}
    end
  end

  defp parse_pattern(value, :attribute) do
    case parse_attribute(value) do
      {:ok, attribute} -> {:ok, attribute}
      _ -> {:error, "unknown attribute"}
    end
  end

  defp parse_pattern(value, :value) when is_binary(value) and value != "", do: {:ok, value}
  defp parse_pattern(_value, :value), do: {:error, "value must be a string"}

  defp parse_find(_attrs, _clauses, true), do: {:ok, []}

  defp parse_find(attrs, clauses, false) do
    case Map.get(attrs, "find") do
      find when is_list(find) and find != [] ->
        known = clause_variables(clauses)

        find
        |> Enum.reduce_while({:ok, []}, fn name, {:ok, acc} ->
          case normalize_find(name, known) do
            {:ok, var} -> {:cont, {:ok, [var | acc]}}
            {:error, _} = err -> {:halt, err}
          end
        end)
        |> case do
          {:ok, rev} -> {:ok, Enum.reverse(rev) |> Enum.uniq()}
          err -> err
        end

      _ ->
        {:error, "find must be a non-empty list"}
    end
  end

  defp clause_variables(clauses) do
    Enum.reduce(clauses, MapSet.new(), fn clause, acc ->
      [clause.e, clause.a, clause.v]
      |> Enum.filter(&Regex.match?(@variable, &1))
      |> Enum.map(fn "?" <> name -> name end)
      |> Enum.into(acc)
    end)
  end

  defp normalize_find(name, known) when is_binary(name) do
    var = String.trim_leading(name, "?")

    if Regex.match?(@var_name, var) and MapSet.member?(known, var) do
      {:ok, var}
    else
      {:error, "unbound find variable"}
    end
  end

  defp normalize_find(_name, _known), do: {:error, "unbound find variable"}

  defp parse_timestamp(value) do
    cond do
      Regex.match?(~r/^\d{4}-\d{2}-\d{2}$/, value) ->
        {:ok, value <> "T00:00:00Z"}

      true ->
        case DateTime.from_iso8601(value) do
          {:ok, datetime, _offset} ->
            {:ok, datetime |> DateTime.truncate(:second) |> DateTime.to_iso8601()}

          _ ->
            :error
        end
    end
  end

  defp echo_as_of(:latest), do: nil
  defp echo_as_of({:tx, n}), do: n
  defp echo_as_of({:at, at}), do: at

  defp echo_valid(:any), do: "any"
  defp echo_valid({:at, at}), do: at

  defp identity(fact), do: {fact.e, fact.a, fact.v, fact.valid_from, fact.valid_to}

  defp fact_to_json(fact) do
    %{
      "op" => fact.op,
      "e" => fact.e,
      "a" => fact.a,
      "v" => fact.v,
      "valid_from" => fact.valid_from,
      "valid_to" => fact.valid_to
    }
  end

  defp append_line(device, line) do
    payload = [Jason.encode!(line), ?\n]

    with :ok <- :file.write(device, payload),
         :ok <- :file.sync(device) do
      :ok
    else
      {:error, reason} -> {:error, "memory log write failed: #{inspect(reason)}"}
    end
  end

  defp mkdir(path) do
    case File.mkdir_p(Path.dirname(path)) do
      :ok -> :ok
      {:error, reason} -> {:error, "memory log write failed: #{inspect(reason)}"}
    end
  end

  defp replay(path) do
    content = if File.exists?(path), do: File.read!(path), else: ""

    content
    |> complete_lines()
    |> Enum.with_index(1)
    |> Enum.reduce_while({:ok, [], 0}, fn {line, number}, {:ok, facts, previous} ->
      case decode_line(line, number, previous) do
        {:ok, more, tx} -> {:cont, {:ok, facts ++ more, tx}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, facts, _tx} -> {:ok, facts}
      {:error, reason} -> {:error, reason}
    end
  end

  defp complete_lines(content) do
    body =
      if String.ends_with?(content, "\n") do
        content
      else
        case String.split(content, "\n") do
          [_partial] -> ""
          parts -> Enum.join(Enum.drop(parts, -1), "\n") <> "\n"
        end
      end

    String.split(body, "\n", trim: true)
  end

  defp decode_line(line, number, previous) do
    with {:ok, decoded} <- Jason.decode(line),
         {:ok, tx, at, reason, raw_facts} <- transaction_fields(decoded),
         :ok <- contiguous(tx, previous, number),
         {:ok, facts} <- expand_facts(raw_facts, tx, at, reason, number) do
      {:ok, facts, tx}
    else
      {:error, "memory log tx is not contiguous"} ->
        {:error, "memory log tx is not contiguous"}

      {:error, %Jason.DecodeError{}} ->
        {:error, "invalid memory log line #{number}"}

      {:error, _reason} ->
        {:error, "invalid memory log line #{number}"}
    end
  end

  defp transaction_fields(%{"tx" => tx, "at" => at, "reason" => reason, "facts" => facts})
       when is_integer(tx) and tx > 0 and is_binary(at) and is_binary(reason) and is_list(facts) and
              facts != [] do
    {:ok, tx, at, reason, facts}
  end

  defp transaction_fields(_), do: {:error, :invalid}

  defp contiguous(tx, previous, _number) when tx == previous + 1, do: :ok
  defp contiguous(_tx, _previous, _number), do: {:error, "memory log tx is not contiguous"}

  defp expand_facts(raw_facts, tx, at, reason, number) do
    raw_facts
    |> Enum.reduce_while({:ok, []}, fn raw, {:ok, acc} ->
      case expand_fact(raw, tx, at, reason) do
        {:ok, fact} -> {:cont, {:ok, [fact | acc]}}
        :error -> {:halt, {:error, "invalid memory log line #{number}"}}
      end
    end)
    |> case do
      {:ok, rev} -> {:ok, Enum.reverse(rev)}
      err -> err
    end
  end

  defp expand_fact(%{"op" => op, "e" => e, "a" => a, "v" => v} = raw, tx, at, reason)
       when op in ["assert", "retract"] and is_binary(e) and is_binary(a) and is_binary(v) do
    from = Map.get(raw, "valid_from")
    to = Map.get(raw, "valid_to")

    if valid_time?(from) and valid_time?(to) do
      {:ok,
       %{
         tx: tx,
         at: at,
         reason: reason,
         op: op,
         e: e,
         a: a,
         v: v,
         valid_from: from,
         valid_to: to
       }}
    else
      :error
    end
  end

  defp expand_fact(_raw, _tx, _at, _reason), do: :error

  defp valid_time?(nil), do: true
  defp valid_time?(value) when is_binary(value), do: true
  defp valid_time?(_), do: false

  defp now_iso do
    DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  end
end
