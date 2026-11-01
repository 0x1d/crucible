defmodule AgentFn.Codex.UncommittedReport do
  @moduledoc """
  Report on uncommitted codex functions.

  Flow:
  1. `git status --porcelain` under `functions/`
  2. Resolve dirty paths to slugs
  3. Ensure each slug is compiled/loaded (`Runtime.Engine.load/1` when missing)
  4. Read codex meta (summary, module, updated_at, specs)
  5. Enrich from memory (`source_session` + description) and journal
     (`sessions.search` for first mention → `at` / `user_message`)
  6. Render a markdown table

  Args:
  - `repo` — git root (default: parent of functions root)
  - `functions_rel` — path relative to repo (default `functions`)
  - `load_missing` — default true
  - `journal` — search journal for provenance (default true)
  """
  @behaviour AgentFn.Tool

  alias Runtime.{Codex, Engine}

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    functions_root = Codex.functions_root() |> Path.expand()
    repo = (get(args, "repo") || Path.dirname(functions_root)) |> Path.expand()
    rel = get(args, "functions_rel") || "functions"
    load_missing? = truthy?(get(args, "load_missing"), true)
    journal? = truthy?(get(args, "journal"), true)

    with {:ok, porcelain} <- git_porcelain(repo, rel),
         slugs <- porcelain_to_slugs(porcelain, repo, functions_root),
         rows <- Enum.map(slugs, &enrich(&1, load_missing?, journal?)),
         {:ok, table} <-
           AgentFn.Md.Table.run(%{
             "entries" => rows,
             "columns" => [
               "slug",
               "was_loaded",
               "loaded_now",
               "summary",
               "updated_at",
               "memory",
               "source_session",
               "created_at",
               "led_by"
             ]
           }),
         {:ok, heading} <-
           AgentFn.Md.Heading.run(%{
             "text" => "Uncommitted codex functions (#{length(rows)})",
             "level" => 1
           }),
         {:ok, doc} <-
           AgentFn.Md.Concat.run(%{"parts" => [heading, table]}) do
      {:ok,
       %{
         "count" => length(rows),
         "slugs" => slugs,
         "rows" => rows,
         "markdown" => doc["markdown"],
         "repo" => repo,
         "porcelain" => Enum.map(porcelain, & &1["path"])
       }}
    end
  end

  defp git_porcelain(repo, rel) do
    case System.cmd("git", ["-C", repo, "status", "--porcelain", "--", rel],
           stderr_to_stdout: true
         ) do
      {out, 0} ->
        lines =
          out
          |> String.split("\n", trim: true)
          |> Enum.map(&parse_porcelain/1)
          |> Enum.reject(&is_nil/1)

        {:ok, lines}

      {out, code} ->
        {:error, "git status failed (#{code}): #{String.trim(out)}"}
    end
  end

  # XY PATH or XY "PATH" or rename "OLD" -> "NEW"
  defp parse_porcelain(line) when is_binary(line) and byte_size(line) >= 4 do
    path =
      line
      |> String.slice(3..-1//1)
      |> String.trim()
      |> String.trim("\"")

    path =
      case String.split(path, " -> ") do
        [_, new_path] -> String.trim(new_path) |> String.trim("\"")
        [only] -> only
      end

    if path == "", do: nil, else: %{"path" => path}
  end

  defp parse_porcelain(_), do: nil

  defp porcelain_to_slugs(lines, repo, functions_root) do
    lines
    |> Enum.flat_map(fn %{"path" => path} ->
      abs = Path.expand(path, repo)
      slugs_for_path(abs, functions_root)
    end)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp slugs_for_path(abs, functions_root) do
    functions_root = Path.expand(functions_root)

    cond do
      File.regular?(abs) and Path.basename(abs) in ["tool.ex", "meta.json"] ->
        [path_to_slug(Path.dirname(abs), functions_root)]

      File.dir?(abs) ->
        tools = Path.wildcard(Path.join(abs, "**/tool.ex"))

        tools =
          if tools == [] and File.regular?(Path.join(abs, "tool.ex")) do
            [Path.join(abs, "tool.ex")]
          else
            tools
          end

        Enum.map(tools, fn tool -> path_to_slug(Path.dirname(tool), functions_root) end)

      true ->
        rel = Path.relative_to(abs, functions_root)

        if rel == abs do
          []
        else
          rel
          |> String.replace(~r/\/(tool\.ex|meta\.json)$/, "")
          |> String.replace("/", ".")
          |> List.wrap()
        end
    end
    |> Enum.reject(&(&1 in [nil, ""]))
  end

  defp path_to_slug(dir, functions_root) do
    dir
    |> Path.expand()
    |> Path.relative_to(Path.expand(functions_root))
    |> String.replace("/", ".")
  end

  defp enrich(slug, load_missing?, journal?) do
    module = Codex.module_name(slug)
    was_loaded? = ready?(module)
    listed? = File.regular?(Codex.meta_path(slug))

    {loaded_now?, load_error, meta} =
      cond do
        was_loaded? ->
          {true, nil, safe_meta(slug)}

        load_missing? ->
          case Engine.load(slug) do
            %{ok: true, function: meta} -> {true, nil, meta}
            %{ok: false, error: err} -> {false, to_string(err), safe_meta(slug)}
            other -> {false, inspect(other), safe_meta(slug)}
          end

        true ->
          {false, nil, safe_meta(slug)}
      end

    mem = memory_for(slug)
    journal = if journal?, do: journal_for(slug), else: %{}

    %{
      "slug" => slug,
      "was_loaded" => was_loaded?,
      "listed" => listed?,
      "loaded_now" => loaded_now?,
      "load_error" => load_error,
      "module" => meta["module"],
      "summary" => clip(first_line(meta["description"] || meta["moduledoc"]), 72),
      "updated_at" => meta["updated_at"],
      "memory" => clip(mem["description"], 72),
      "memory_entity" => mem["entity"],
      "source_session" => mem["source_session"] || journal["session_id"],
      "created_at" => journal["at"],
      "led_by" => clip(journal["user_message"], 72)
    }
  end

  defp safe_meta(slug) do
    if File.regular?(Codex.meta_path(slug)), do: Codex.load_meta(slug), else: %{"name" => slug}
  end

  defp ready?(module) do
    Code.ensure_loaded?(module) and function_exported?(module, :run, 1)
  end

  defp memory_for(slug) do
    case AgentFn.Codex.call("memory.query", %{
           "where" => [
             %{"e" => "?e", "a" => "description", "v" => "?text"}
           ],
           "find" => ["e", "text"]
         }) do
      {:ok, %{"rows" => rows}} when is_list(rows) ->
        needle = String.downcase(slug)
        tail = slug_tail(needle)

        match =
          Enum.find(rows, fn row ->
            e = String.downcase(to_string(row["e"] || row["entity"] || ""))
            t = String.downcase(to_string(row["text"] || ""))
            String.contains?(e, tail) or String.contains?(t, needle)
          end)

        case match do
          nil ->
            %{}

          row ->
            entity = row["e"] || row["entity"]

            %{
              "entity" => entity,
              "description" => row["text"],
              "source_session" => source_session_for(entity)
            }
        end

      _ ->
        %{}
    end
  end

  defp source_session_for(entity) when is_binary(entity) do
    case AgentFn.Codex.call("memory.query", %{
           "where" => [
             %{"e" => entity, "a" => "source_session", "v" => "?sid"}
           ],
           "find" => ["sid"]
         }) do
      {:ok, %{"rows" => [%{"sid" => sid} | _]}} -> sid
      {:ok, %{"rows" => [row | _]}} when is_map(row) -> row["sid"] || row[:sid]
      _ -> nil
    end
  end

  defp source_session_for(_), do: nil

  defp journal_for(slug) do
    case AgentFn.Codex.call("sessions.search", %{
           "pattern" => slug,
           "fixed_strings" => true,
           "max_matches" => 8
         }) do
      {:ok, %{"hits" => hits}} when is_list(hits) and hits != [] ->
        hit = Enum.min_by(hits, fn h -> h["at"] || "~" end)

        %{
          "at" => hit["at"],
          "session_id" => hit["session_id"],
          "user_message" => hit["user_message"]
        }

      _ ->
        %{}
    end
  end

  defp slug_tail(slug), do: slug |> String.split(".") |> List.last()

  defp first_line(nil), do: nil

  defp first_line(text) when is_binary(text) do
    text |> String.split("\n", parts: 2) |> hd() |> String.trim()
  end

  defp clip(nil, _), do: nil

  defp clip(text, n) when is_binary(text) and is_integer(n) do
    if String.length(text) <= n, do: text, else: String.slice(text, 0, n) <> "…"
  end

  defp clip(other, _), do: other

  defp get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, String.to_atom(key))
  end

  defp truthy?(v, default) when v in [nil, ""], do: default
  defp truthy?(v, _) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(v, _) when v in [false, "false", "0", 0, "no"], do: false
  defp truthy?(_, default), do: default
end