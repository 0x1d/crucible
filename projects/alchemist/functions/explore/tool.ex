defmodule AgentFn.Explore do
  @moduledoc """
  Composed exploration: memory recall, git, search, or custom `pipeline.run` in one call.

  Prefer this over chaining `call_function` for probes when the host sets
  `requireExploreBeforeProbe`. Returns essentials only (compact git, capped lists).

  Profiles:
  - `status` — memory recall + compact git + oneline log + optional handoff head
  - `memory` — entity ids with descriptions
  - `repo` — compact git + oneline log
  - `code` — `fs.rg` with low match cap
  - `custom` — `steps` forwarded to `pipeline.run` (seed includes memory when `recall_memory`)

  Args: `profile`, `goal`, `repo`/`cwd`, `query`, `paths`, `limit` (default 12),
  `recall_memory` (default true), `steps` (custom only).
  """
  @behaviour AgentFn.Tool

  alias AgentFn.{Fs, Git, Memory, Pipeline, Sys}

  @default_limit 12

  @type args :: map()

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    profile = normalize_profile(get(args, "profile"))
    limit = int_limit(get(args, "limit"))
    cwd = repo_root(args)
    recall? = truthy?(get(args, "recall_memory"), true)
    goal = get(args, "goal")

    with :ok <- validate_profile(profile, args) do
      case profile do
        "memory" -> run_memory(limit)
        "repo" -> run_repo(cwd, args, limit)
        "code" -> run_code(args, limit)
        "custom" -> run_custom(args, recall?, limit)
        "status" -> run_status(cwd, args, limit, recall?)
      end
      |> wrap_goal(goal, profile)
    end
  end

  defp wrap_goal({:ok, map}, goal, profile) when is_map(map) do
    {:ok,
     map
     |> Map.put("profile", profile)
     |> maybe_put("goal", goal)}
  end

  defp wrap_goal(other, _, _), do: other

  defp run_status(cwd, args, limit, recall?) do
    with {:ok, memory} <- maybe_recall(recall?, limit),
         {:ok, git} <- compact_git(cwd, args, limit),
         {:ok, log} <- oneline_log(cwd, limit),
         {:ok, handoff} <- handoff_head(cwd) do
      summary =
        [
          "## Status",
          git_summary(git),
          "",
          "### Recent commits",
          Enum.join(log["lines"] || [], "\n"),
          "",
          memory_summary(memory)
        ]
        |> Enum.join("\n")

      {:ok,
       %{
         "summary_md" => summary,
         "memory" => memory,
         "git" => git,
         "log" => log,
         "handoff" => handoff
       }}
    end
  end

  defp run_memory(limit) do
    with {:ok, recall} <- memory_recall(limit) do
      {:ok, Map.put(recall, "profile", "memory")}
    end
  end

  defp run_repo(cwd, args, limit) do
    with {:ok, git} <- compact_git(cwd, args, limit),
         {:ok, log} <- oneline_log(cwd, limit) do
      {:ok,
       %{
         "branch" => git["branch"],
         "upstream" => git["upstream"],
         "ahead" => git["ahead"],
         "behind" => git["behind"],
         "counts" => git["counts"],
         "paths_sample" => git["paths_sample"],
         "log_lines" => log["lines"]
       }}
    end
  end

  defp run_code(args, limit) do
    query = get(args, "query")
    path = get(args, "path") || get(args, "root") || ".."

    if not is_binary(query) or query == "" do
      {:error, "code profile requires non-empty query"}
    else
      max = min(limit * 2, 40)

      case Fs.Rg.run(%{
             "pattern" => query,
             "path" => path,
             "max_matches" => max
           }) do
        {:ok, r} ->
          matches =
            (r["matches"] || [])
            |> Enum.take(limit)
            |> Enum.map(fn m ->
              %{
                "path" => m["path"],
                "line" => m["line"],
                "text" => String.trim(m["text"] || "")
              }
            end)

          {:ok, %{"matches" => matches, "count" => r["count"] || length(matches)}}

        {:error, e} ->
          {:error, to_string(e)}
      end
    end
  end

  defp run_custom(args, recall?, _limit) do
    steps = get(args, "steps")

    if not is_list(steps) or steps == [] do
      {:error, "custom profile requires non-empty steps"}
    else
      seed =
        case maybe_recall(recall?, @default_limit) do
          {:ok, mem} -> %{"memory" => mem}
          _ -> %{}
        end

      case Pipeline.Run.run(%{"steps" => steps, "seed" => seed, "max_steps" => 20}) do
        {:ok, out} ->
          {:ok,
           %{
             "ok" => out["ok"],
             "count" => out["count"],
             "result" => out["result"],
             "steps" => trim_trace(out["steps"])
           }}

        {:error, e} ->
          {:error, to_string(e)}
      end
    end
  end

  defp maybe_recall(false, _), do: {:ok, %{"skipped" => true}}
  defp maybe_recall(true, limit), do: memory_recall(limit)

  defp memory_recall(limit) do
    with {:ok, overview} <- Memory.Overview.run(%{"limit" => limit}),
         ids <- overview["entities"] || [],
         {:ok, query} <- descriptions_for(ids, limit) do
      entities =
        for row <- query["rows"] || [] do
          %{"id" => row["e"], "description" => row["v"]}
        end

      {:ok, %{"entities" => entities, "count" => length(entities)}}
    else
      {:error, e} -> {:error, to_string(e)}
    end
  end

  defp descriptions_for([], _), do: {:ok, %{"rows" => []}}

  defp descriptions_for(ids, limit) do
    take = Map.new(Enum.take(ids, limit), &{&1, true})

    case Memory.Query.run(%{
           "where" => [["?e", "description", "?v"]],
           "find" => ["e", "v"]
         }) do
      {:ok, r} ->
        rows =
          for row <- r["rows"] || [], Map.has_key?(take, row["e"]) do
            row
          end

        {:ok, %{"rows" => rows}}

      other ->
        other
    end
  end

  defp compact_git(cwd, args, limit) do
    paths = get(args, "paths")
    call_args = %{"cwd" => cwd}
    call_args = if paths, do: Map.put(call_args, "paths", paths), else: call_args

    case Git.Status.run(call_args) do
      {:ok, full} ->
        sample = fn key ->
          (full[key] || [])
          |> Enum.take(limit)
        end

        {:ok,
         %{
           "branch" => full["branch"],
           "upstream" => full["upstream"],
           "ahead" => full["ahead"],
           "behind" => full["behind"],
           "clean" => full["clean"],
           "counts" => full["counts"],
           "paths_sample" => %{
             "staged" => sample.("staged"),
             "unstaged" => sample.("unstaged"),
             "untracked" => sample.("untracked"),
             "conflicted" => sample.("conflicted")
           }
         }}

      {:error, e} ->
        {:error, to_string(e)}
    end
  end

  defp oneline_log(cwd, limit) do
    n = min(limit, 20)

    case Sys.Cmd.run(%{
           "argv" => ["git", "log", "--oneline", "-n", Integer.to_string(n)],
           "cwd" => cwd,
           "timeout_ms" => 30_000
         }) do
      {:ok, %{"status" => 0} = r} ->
        lines =
          (get(r, "stdout") || "")
          |> String.split("\n", trim: true)

        {:ok, %{"lines" => lines, "count" => length(lines)}}

      {:ok, r} ->
        {:error, "git log failed: #{get(r, "stderr") || get(r, "stdout")}"}

      {:error, e} ->
        {:error, to_string(e)}
    end
  end

  defp handoff_head(cwd) do
    path = Path.join(cwd, "handoff.md")

    case Fs.Read.run(%{"path" => path, "max_bytes" => 2048}) do
      {:ok, r} -> {:ok, %{"present" => true, "head" => r["content"], "truncated" => r["truncated"]}}
      {:error, _} -> {:ok, %{"present" => false}}
    end
  end

  defp trim_trace(nil), do: []

  defp trim_trace(steps) when is_list(steps) do
    Enum.map(steps, fn step ->
      %{
        "index" => step["index"],
        "label" => step["label"],
        "name" => step["name"],
        "ok" => step["ok"],
        "error" => step["error"]
      }
    end)
  end

  defp git_summary(git) do
    branch = git["branch"] || "(detached)"
    up = git["upstream"]
    ab = "ahead #{git["ahead"]} / behind #{git["behind"]}"
    base = if up, do: "#{branch} tracking #{up} (#{ab})", else: branch
    counts = git["counts"] || %{}
    "**Git:** #{base}; staged=#{counts["staged"] || 0}, unstaged=#{counts["unstaged"] || 0}, untracked=#{counts["untracked"] || 0}"
  end

  defp memory_summary(%{"skipped" => true}), do: "### Memory\n(recall skipped)"

  defp memory_summary(%{"entities" => ents}) do
    lines =
      for %{"id" => id, "description" => d} <- ents do
        "- `#{id}`: #{String.slice(d, 0, 200)}"
      end

    "### Memory (#{length(ents)})\n" <> Enum.join(lines, "\n")
  end

  defp memory_summary(_), do: "### Memory\n(empty)"

  defp validate_profile("custom", args) do
    steps = get(args, "steps")
    if is_list(steps) and steps != [], do: :ok, else: {:error, "custom profile requires steps"}
  end

  defp validate_profile("code", args) do
    q = get(args, "query")
    if is_binary(q) and q != "", do: :ok, else: {:error, "code profile requires query"}
  end

  defp validate_profile(_, _), do: :ok

  defp normalize_profile(nil), do: "status"
  defp normalize_profile(p) when is_binary(p), do: String.downcase(p)
  defp normalize_profile(_), do: "status"

  defp repo_root(args) do
    get(args, "repo") || get(args, "cwd") || default_repo()
  end

  # Runtime cwd is usually `runtime/`; explore targets the repo root above it.
  defp default_repo, do: Path.expand("..", File.cwd!())

  defp int_limit(nil), do: @default_limit
  defp int_limit(n) when is_integer(n) and n > 0, do: min(n, 50)
  defp int_limit(n) when is_binary(n) do
    case Integer.parse(n) do
      {i, _} when i > 0 -> min(i, 50)
      _ -> @default_limit
    end
  end

  defp int_limit(_), do: @default_limit

  defp get(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, String.to_atom(key))
  defp get(_, _), do: nil

  defp truthy?(v, default) when v in [nil, ""], do: default
  defp truthy?(v, _) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(v, _) when v in [false, "false", "0", 0, "no"], do: false
  defp truthy?(_, default), do: default

  defp maybe_put(map, _k, nil), do: map
  defp maybe_put(map, k, v), do: Map.put(map, k, v)
end