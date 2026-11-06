defmodule AgentFn.Pipeline.Run do
  @moduledoc """
  Dynamic multi-step codex pipeline via `AgentFn.Codex.call/2`.

  Use this for explorative or transitive chains where static Elixir
  composition does not fit. Prefer a dedicated entry when the graph is fixed.

  Args:
  - `steps` (required) — list of step maps:
      - `name` / `call` — slug (required)
      - `args` — map; string/`$ref` values may reference prior data (below)
      - `merge_prev` — merge previous result into args (args win)
      - `as` — place previous result at this key in args
      - `label` — optional trace label
  - `seed` / `ctx` — optional initial context map
  - `stop_on_error` — default true
  - `max_steps` — safety cap (default 20)

  Refs in arg values:
  - `"$prev"` — whole previous step result
  - `"$prev.hits.0.session_id"` — dotted path (map keys / list indices)
  - `"$ctx.…"` / `"$seed.…"` — context / seed paths
  - `%{"$ref" => "prev.hits.0.session_id"}` — same, without the `$` prefix style

  After each success, `prev` becomes that result and `ctx` is shallow-merged
  with it (result keys overwrite).

  Returns `result` (last ok result), `steps` (trace), `ctx`, `count`, `ok`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:ctx) => map(),
    optional(:max_steps) => non_neg_integer(),
    optional(:seed) => map(),
    required(:steps) => [map()],
    optional(:stop_on_error) => boolean()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    steps = get(args, "steps")
    seed = stringify_keys(get(args, "seed") || get(args, "ctx") || %{})
    stop_on_error? = truthy?(get(args, "stop_on_error"), true)
    max_steps = get(args, "max_steps") || 20

    with :ok <- validate_steps(steps, max_steps) do
      seed = if is_map(seed), do: seed, else: %{}

      {trace, prev, ctx, halted?} =
        steps
        |> Enum.with_index(1)
        |> Enum.reduce_while({[], nil, seed, false}, fn {step, idx}, {trace, prev, ctx, _} ->
          case run_step(step, idx, prev, ctx, seed) do
            {:ok, entry, result, new_ctx} ->
              {:cont, {[entry | trace], result, new_ctx, false}}

            {:error, entry} ->
              trace = [entry | trace]

              if stop_on_error? do
                {:halt, {trace, prev, ctx, true}}
              else
                {:cont, {trace, prev, ctx, false}}
              end
          end
        end)

      trace = Enum.reverse(trace)
      ok? = not halted? and Enum.all?(trace, & &1["ok"])

      out = %{
        "ok" => ok?,
        "count" => length(trace),
        "result" => prev,
        "ctx" => ctx,
        "steps" => trace,
        "halted" => halted?
      }

      if ok?, do: {:ok, out}, else: {:ok, out}
    end
  end

  defp validate_steps(steps, max_steps) do
    cond do
      not is_list(steps) or steps == [] ->
        {:error, "steps must be a non-empty list"}

      not is_integer(max_steps) or max_steps < 1 ->
        {:error, "max_steps must be a positive integer"}

      length(steps) > max_steps ->
        {:error, "steps exceeds max_steps (#{max_steps})"}

      true ->
        :ok
    end
  end

  defp run_step(step, idx, prev, ctx, seed) when is_map(step) do
    name = get(step, "name") || get(step, "call")
    label = get(step, "label") || name || "step_#{idx}"
    raw_args = get(step, "args") || %{}
    merge_prev? = truthy?(get(step, "merge_prev"), false)
    as = get(step, "as")

    cond do
      not is_binary(name) or name == "" ->
        {:error,
         %{
           "index" => idx,
           "label" => label,
           "name" => name,
           "ok" => false,
           "error" => "step.name (or call) is required"
         }}

      name == "pipeline.run" ->
        {:error,
         %{
           "index" => idx,
           "label" => label,
           "name" => name,
           "ok" => false,
           "error" => "pipeline.run cannot nest itself"
         }}

      true ->
        with {:ok, resolved} <- resolve_args(raw_args, prev, ctx, seed),
             args <- maybe_merge(resolved, prev, merge_prev?, as),
             {:ok, result} <- AgentFn.Codex.call(name, args) do
          new_ctx = Map.merge(ctx, stringify_keys(result))

          entry = %{
            "index" => idx,
            "label" => label,
            "name" => name,
            "ok" => true,
            "result" => result
          }

          {:ok, entry, result, new_ctx}
        else
          {:error, reason} ->
            {:error,
             %{
               "index" => idx,
               "label" => label,
               "name" => name,
               "ok" => false,
               "error" => to_string(reason)
             }}
        end
    end
  end

  defp run_step(_, idx, _, _, _) do
    {:error,
     %{
       "index" => idx,
       "label" => "step_#{idx}",
       "name" => nil,
       "ok" => false,
       "error" => "each step must be a map"
     }}
  end

  defp maybe_merge(args, prev, true, as) when is_map(prev) do
    base = if is_binary(as) and as != "", do: %{as => prev}, else: prev
    Map.merge(stringify_keys(base), args)
  end

  defp maybe_merge(args, prev, false, as) when is_binary(as) and as != "" and not is_nil(prev) do
    Map.put(args, as, prev)
  end

  defp maybe_merge(args, _, _, _), do: args

  defp resolve_args(args, prev, ctx, seed) when is_map(args) do
    try do
      {:ok,
       args
       |> stringify_keys()
       |> Map.new(fn {k, v} -> {k, resolve_value(v, prev, ctx, seed)} end)}
    rescue
      e in [RuntimeError, ArgumentError] -> {:error, Exception.message(e)}
    end
  end

  defp resolve_args(_, _, _, _), do: {:error, "step.args must be a map"}

  defp resolve_value(%{"$ref" => path}, prev, ctx, seed) when is_binary(path) do
    resolve_ref(path, prev, ctx, seed)
  end

  defp resolve_value(list, prev, ctx, seed) when is_list(list) do
    Enum.map(list, &resolve_value(&1, prev, ctx, seed))
  end

  defp resolve_value(map, prev, ctx, seed) when is_map(map) do
    map
    |> stringify_keys()
    |> Map.new(fn {k, v} -> {k, resolve_value(v, prev, ctx, seed)} end)
  end

  defp resolve_value("$prev", prev, _, _), do: prev

  defp resolve_value("$ctx", _, ctx, _), do: ctx

  defp resolve_value("$seed", _, _, seed), do: seed

  defp resolve_value("$" <> rest, prev, ctx, seed) do
    resolve_ref(rest, prev, ctx, seed)
  end

  defp resolve_value(other, _, _, _), do: other

  defp resolve_ref(path, prev, ctx, seed) do
    {root, rest} =
      case String.split(path, ".", parts: 2) do
        ["prev"] -> {prev, nil}
        ["prev", r] -> {prev, r}
        ["ctx"] -> {ctx, nil}
        ["ctx", r] -> {ctx, r}
        ["seed"] -> {seed, nil}
        ["seed", r] -> {seed, r}
        # bare path defaults to prev
        [r] -> {prev, r}
        parts ->
          # "hits.0.x" → prev
          {prev, Enum.join(parts, ".")}
      end

    case rest do
      nil -> root
      path -> get_path!(root, path)
    end
  end

  defp get_path!(nil, path), do: raise("ref $prev.#{path} (previous result is nil)")

  defp get_path!(root, path) do
    parts = String.split(path, ".", trim: true)

    Enum.reduce(parts, root, fn part, acc ->
      cond do
        is_map(acc) and Map.has_key?(acc, part) ->
          Map.get(acc, part)

        is_map(acc) and Map.has_key?(acc, String.to_atom(part)) ->
          Map.get(acc, String.to_atom(part))

        is_list(acc) and Regex.match?(~r/^\d+$/, part) ->
          Enum.at(acc, String.to_integer(part)) ||
            raise("ref index #{part} out of range (len=#{length(acc)})")

        true ->
          raise("cannot resolve path segment #{inspect(part)} in #{inspect(acc, limit: 3)}")
      end
    end)
  end

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} when is_binary(k) -> {k, v}
      {k, v} -> {to_string(k), v}
    end)
  end

  defp stringify_keys(other), do: other

  defp get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, String.to_atom(key))
  end

  defp truthy?(v, default) when v in [nil, ""], do: default
  defp truthy?(v, _) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(v, _) when v in [false, "false", "0", 0, "no"], do: false
  defp truthy?(_, default), do: default
end