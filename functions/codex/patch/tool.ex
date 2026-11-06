defmodule AgentFn.Codex.Patch do
  @moduledoc """
  Apply targeted search/replace edits to a codex entry's `tool.ex`, then recompile.

  Avoids resending a whole module through `define_function` for small changes.

  Flow:
  1. Read `functions/<slug>/tool.ex`
  2. Apply `edits` in order; each `old` must match **exactly once** in the current
     text (unless `replace_all: true` on that edit) — otherwise nothing is written
  3. `dry_run` → return a unified diff and stop
  4. Write the file and recompile via `Runtime.Engine.load/1` (serialized through
     `Runtime.Server`), which also resyncs `meta.json` (source_sha256, updated_at,
     moduledoc, specs)
  5. If compilation fails, the original file is restored; the running module and
     `meta.json` stay unchanged

  Args:
  - `slug` / `name` (required) — codex entry to patch
  - `edits` (required) — list of `%{"old" => string, "new" => string}`;
    optional per-edit `"replace_all" => true`
  - `dry_run` — return the diff without writing (default false)

  Returns `slug`, `path`, `applied` (per-edit match counts), `diff`, and on a real
  run `function` (refreshed meta) or the compile error.
  """

  alias Runtime.Codex
  alias Runtime.Engine
  alias AgentFn.Sys.Cmd
  @type args :: %{
    optional(:dry_run) => boolean(),
    required(:edits) => [map()],
    optional(:name) => String.t(),
    required(:slug) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, slug} <- fetch_slug(args),
         {:ok, edits} <- fetch_edits(args),
         path = Codex.source_path(slug),
         {:ok, original} <- read_source(path),
         {:ok, patched, applied} <- apply_edits(original, edits) do
      diff = unified_diff(original, patched, slug)

      cond do
        patched == original ->
          {:error, "edits produced no change"}

        truthy?(args["dry_run"]) ->
          {:ok,
           %{"dry_run" => true, "slug" => slug, "path" => path, "applied" => applied, "diff" => diff}}

        true ->
          write_and_load(slug, path, original, patched, applied, diff)
      end
    end
  end

  def run(_), do: {:error, "args must be a map"}

  # --- edits -----------------------------------------------------------------

  defp apply_edits(text, edits) do
    edits
    |> Enum.with_index(1)
    |> Enum.reduce_while({:ok, text, []}, fn {edit, i}, {:ok, acc, applied} ->
      old = edit["old"]
      new = edit["new"]
      all? = truthy?(edit["replace_all"])
      count = count_occurrences(acc, old)

      cond do
        count == 0 ->
          {:halt, {:error, "edit #{i}: `old` text not found"}}

        count > 1 and not all? ->
          {:halt,
           {:error,
            "edit #{i}: `old` text matches #{count} times; add more context or set replace_all"}}

        true ->
          updated = String.replace(acc, old, new, global: all?)
          {:cont, {:ok, updated, applied ++ [%{"edit" => i, "matches" => count}]}}
      end
    end)
  end

  defp count_occurrences(text, pattern) do
    length(:binary.matches(text, pattern))
  end

  # --- write / compile / rollback -------------------------------------------

  defp write_and_load(slug, path, original, patched, applied, diff) do
    File.write!(path, patched)

    case load(slug) do
      %{ok: true, function: meta} ->
        {:ok,
         %{
           "slug" => slug,
           "path" => path,
           "applied" => applied,
           "diff" => diff,
           "function" => meta
         }}

      %{ok: false, error: err} ->
        File.write!(path, original)
        {:error, "compile failed, original restored: #{err}"}

      other ->
        File.write!(path, original)
        {:error, "unexpected load result, original restored: #{inspect(other)}"}
    end
  end

  defp load(slug) do
    if Process.whereis(Runtime.Server) do
      Runtime.Server.serialize(fn -> Engine.load(slug) end)
    else
      Engine.load(slug)
    end
  end

  # --- diff ------------------------------------------------------------------

  defp unified_diff(a, b, slug) do
    dir = Path.join(System.tmp_dir!(), "codex_patch_#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    pa = Path.join(dir, "a.ex")
    pb = Path.join(dir, "b.ex")
    File.write!(pa, a)
    File.write!(pb, b)

    try do
      label = "functions/#{String.replace(slug, ".", "/")}/tool.ex"

      case Cmd.run(%{"argv" => ["diff", "-u", "--label", "a/" <> label, "--label", "b/" <> label, pa, pb]}) do
        {:ok, r} -> Map.get(r, "stdout") || Map.get(r, :stdout) || ""
        {:error, e} -> "diff unavailable: #{inspect(e)}"
      end
    after
      File.rm_rf(dir)
    end
  end

  # --- args ------------------------------------------------------------------

  defp fetch_slug(args) do
    case args["slug"] || args["name"] do
      s when is_binary(s) and s != "" -> {:ok, Codex.sanitize(s)}
      _ -> {:error, "slug (string) is required"}
    end
  end

  defp fetch_edits(%{"edits" => edits}) when is_list(edits) and edits != [] do
    if Enum.all?(edits, &valid_edit?/1) do
      {:ok, edits}
    else
      {:error, "each edit needs a non-empty string `old` and a string `new`"}
    end
  end

  defp fetch_edits(_), do: {:error, "edits (non-empty list) is required"}

  defp valid_edit?(%{"old" => old, "new" => new}) when is_binary(old) and is_binary(new),
    do: old != ""

  defp valid_edit?(_), do: false

  defp read_source(path) do
    case File.read(path) do
      {:ok, body} -> {:ok, body}
      {:error, reason} -> {:error, "cannot read #{path}: #{inspect(reason)}"}
    end
  end

  defp truthy?(v), do: v in [true, "true", 1, "1"]
end