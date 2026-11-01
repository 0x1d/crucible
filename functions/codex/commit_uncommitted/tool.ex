defmodule AgentFn.Codex.CommitUncommitted do
  @moduledoc """
  Commit each uncommitted codex function as its own git commit.

  Reuses `codex.uncommitted_report` (static composition) for discovery,
  load-if-needed, meta, memory, and journal provenance.

  Args:
  - `dry_run` — default **true**; set `false` to create commits
  - `slugs` — optional list of slugs to include (subset of dirty)
  - `repo`, `functions_rel`, `load_missing`, `journal` — forwarded to the report

  Commit message shape:
  - subject: `feat(<scope>): <summary>` (scope = first slug segment)
  - body: memory blurb, then session cue (`led_by` + `source_session`)
  """
  @behaviour AgentFn.Tool

  alias AgentFn.Codex.UncommittedReport
  alias Runtime.Codex

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    dry_run? = truthy?(fetch(args, "dry_run"), true)
    only = normalize_slugs(fetch(args, "slugs"))

    report_args =
      args
      |> Map.drop(["dry_run", :dry_run, "slugs", :slugs])

    with {:ok, report} <- UncommittedReport.run(report_args) do
      rows =
        report["rows"]
        |> List.wrap()
        |> Enum.filter(fn row ->
          slug = row["slug"]
          is_binary(slug) and (only == nil or slug in only)
        end)

      repo = report["repo"] || Path.dirname(Codex.functions_root())
      plans = Enum.map(rows, &plan_commit(&1, repo))

      results =
        if dry_run? do
          Enum.map(plans, &Map.put(&1, "committed", false))
        else
          Enum.map(plans, &apply_commit/1)
        end

      committed = Enum.count(results, & &1["committed"])

      {:ok,
       %{
         "dry_run" => dry_run?,
         "count" => length(results),
         "committed" => committed,
         "commits" => results,
         "report_count" => report["count"]
       }}
    end
  end

  defp normalize_slugs(nil), do: nil
  defp normalize_slugs([]), do: nil

  defp normalize_slugs(list) when is_list(list) do
    list |> Enum.filter(&is_binary/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_slugs(_), do: nil

  defp plan_commit(row, repo) do
    slug = row["slug"]
    rel = Path.join("functions", slug_to_rel(slug))
    abs = Path.join(repo, rel)

    %{
      "slug" => slug,
      "path" => rel,
      "abs_path" => abs,
      "path_exists" => File.exists?(abs),
      "subject" => build_subject(slug, row["summary"]),
      "body" => build_body(row),
      "repo" => repo,
      "source_session" => row["source_session"],
      "memory_entity" => row["memory_entity"],
      "created_at" => row["created_at"]
    }
  end

  defp apply_commit(%{"path_exists" => false} = plan) do
    plan
    |> Map.put("committed", false)
    |> Map.put("error", "path missing: #{plan["path"]}")
  end

  defp apply_commit(plan) do
    repo = plan["repo"]
    rel = plan["path"]

    with {_, 0} <- System.cmd("git", ["-C", repo, "add", "--", rel], stderr_to_stdout: true),
         {:ok, out} <- git_commit(repo, plan["subject"], plan["body"]) do
      plan
      |> Map.put("committed", true)
      |> Map.put("git_out", String.trim(out))
    else
      {out, code} when is_binary(out) and is_integer(code) ->
        plan
        |> Map.put("committed", false)
        |> Map.put("error", "git add/commit failed (#{code}): #{String.trim(out)}")

      {:error, reason} ->
        plan
        |> Map.put("committed", false)
        |> Map.put("error", reason)
    end
  end

  defp git_commit(repo, subject, body) do
    argv =
      ["-C", repo, "commit", "-m", subject] ++
        if(is_binary(body) and String.trim(body) != "", do: ["-m", body], else: [])

    case System.cmd("git", argv, stderr_to_stdout: true) do
      {out, 0} -> {:ok, out}
      {out, code} -> {:error, "git commit failed (#{code}): #{String.trim(out)}"}
    end
  end

  defp slug_to_rel(slug), do: String.replace(slug, ".", "/")

  defp build_subject(slug, summary) do
    scope = slug |> String.split(".") |> hd()
    leaf = slug |> String.split(".") |> List.last()
    summary = summary |> to_string() |> String.trim() |> strip_trailing_dot()

    short =
      cond do
        summary == "" ->
          "add #{leaf}"

        String.contains?(String.downcase(summary), String.downcase(leaf)) ->
          clip(downcase_first_if_needed(summary), 72)

        true ->
          clip("add #{leaf}: #{downcase_first_if_needed(summary)}", 72)
      end

    if Regex.match?(~r/^(feat|fix|docs|chore|refactor)(\(|:)/i, short) do
      short
    else
      "feat(#{scope}): #{short}"
    end
  end

  defp build_body(row) do
    []
    |> maybe_part(row["memory"], & &1)
    |> maybe_part(row["led_by"], fn led ->
      case row["source_session"] do
        sid when is_binary(sid) and sid != "" -> "Session cue (#{sid}): #{led}"
        _ -> "Session cue: #{led}"
      end
    end)
    |> maybe_part(row["memory_entity"], fn e -> "Memory entity: #{e}" end)
    |> Enum.join("\n\n")
  end

  defp maybe_part(acc, val, _fun) when val in [nil, ""], do: acc
  defp maybe_part(acc, val, fun) when is_binary(val), do: acc ++ [fun.(val)]
  defp maybe_part(acc, _, _), do: acc

  defp strip_trailing_dot(text), do: String.replace(text, ~r/\.+$/, "")

  defp downcase_first_if_needed(<<c::utf8, rest::binary>>) when c >= ?A and c <= ?Z do
    String.downcase(<<c::utf8>>) <> rest
  end

  defp downcase_first_if_needed(text), do: text

  defp clip(text, n) when is_binary(text) and is_integer(n) do
    if String.length(text) <= n, do: text, else: String.slice(text, 0, n - 1) <> "…"
  end

  # Important: do not use `||` — false is a valid stored value (dry_run).
  defp fetch(map, key) when is_map(map) do
    cond do
      Map.has_key?(map, key) -> Map.get(map, key)
      Map.has_key?(map, String.to_atom(key)) -> Map.get(map, String.to_atom(key))
      true -> nil
    end
  end

  defp truthy?(v, default) when v in [nil, ""], do: default
  defp truthy?(v, _) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(v, _) when v in [false, "false", "0", 0, "no"], do: false
  defp truthy?(_, default), do: default
end