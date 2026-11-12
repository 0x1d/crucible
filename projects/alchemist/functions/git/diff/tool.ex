defmodule AgentFn.Git.Diff do
  @moduledoc """
  Git diff for one repository: per-file line counts, a summary, and an optional patch.

  What gets compared:
  - default — working tree vs index (unstaged changes, like `git diff`)
  - `staged: true` — index vs `HEAD` (like `git diff --cached`)
  - `ref: "HEAD"` — working tree vs a ref (staged + unstaged together)
  - `ref` + `staged: true` — index vs that ref
  - `ref` + `to` — between two refs (like `git diff A B`)

  Untracked files are never included (git diff does not see them); use
  `git.status` to list them.

  Args:
  - `cwd` / `repo` — repository directory (default: runtime cwd)
  - `ref`, `to` — optional revisions; must not start with `-`
  - `staged` — compare the index (default false)
  - `paths` — optional list of pathspecs (passed after `--`)
  - `stat_only` — skip the patch, return only `files` + `summary` (default false)
  - `context` — lines of context in the patch (git default 3)
  - `max_bytes` — patch size cap (default 200_000); `truncated` is set when cut

  Returns `files` (list of `%{path, orig_path, added, deleted, binary}`),
  `summary` (git shortstat line), `totals` (`files`, `added`, `deleted`),
  `patch` (nil when `stat_only`), `patch_bytes`, `truncated`, and `mode`.
  """

  alias AgentFn.Sys.Cmd

  @default_max 200_000
  @type args :: %{
    optional(:cwd) => String.t(),
    optional(:paths) => [String.t()],
    optional(:ref) => String.t(),
    optional(:repo) => String.t(),
    optional(:staged) => boolean(),
    optional(:stat_only) => boolean(),
    optional(:to) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    with {:ok, cwd} <- fetch_cwd(args),
         {:ok, paths} <- fetch_paths(args),
         {:ok, revs} <- fetch_revs(args),
         {:ok, context} <- fetch_int(args, "context", nil),
         {:ok, max_bytes} <- fetch_int(args, "max_bytes", @default_max) do
      staged? = truthy?(args["staged"])

      if staged? and length(revs) == 2 do
        {:error, "staged cannot be combined with both ref and to"}
      else
        diff(cwd, paths, revs, staged?, context, max_bytes, truthy?(args["stat_only"]))
      end
    end
  end

  def run(_), do: {:error, "args must be a map"}

  defp diff(cwd, paths, revs, staged?, context, max_bytes, stat_only?) do
    common = ["diff", "--no-color", "--no-ext-diff"] ++ if(staged?, do: ["--cached"], else: [])
    tail = revs ++ ["--" | paths]

    with {:ok, numstat} <- git(cwd, common ++ ["--numstat", "-z"] ++ tail),
         {:ok, short} <- git(cwd, common ++ ["--shortstat"] ++ tail),
         {:ok, patch} <- maybe_patch(cwd, common, context, tail, stat_only?) do
      files = parse_numstat(numstat)

      {patch_out, truncated} =
        cond do
          patch == nil -> {nil, false}
          byte_size(patch) > max_bytes -> {safe_cut(patch, max_bytes), true}
          true -> {patch, false}
        end

      {:ok,
       %{
         "cwd" => cwd,
         "mode" => mode(revs, staged?),
         "revs" => revs,
         "paths" => paths,
         "files" => files,
         "summary" => String.trim(short),
         "totals" => %{
           "files" => length(files),
           "added" => files |> Enum.map(&(&1["added"] || 0)) |> Enum.sum(),
           "deleted" => files |> Enum.map(&(&1["deleted"] || 0)) |> Enum.sum()
         },
         "patch" => patch_out,
         "patch_bytes" => if(patch, do: byte_size(patch), else: 0),
         "truncated" => truncated
       }}
    end
  end

  defp maybe_patch(_cwd, _common, _context, _tail, true), do: {:ok, nil}

  defp maybe_patch(cwd, common, context, tail, false) do
    ctx = if context, do: ["-U#{context}"], else: []
    git(cwd, common ++ ctx ++ tail)
  end

  defp mode([], false), do: "worktree_vs_index"
  defp mode([], true), do: "index_vs_HEAD"
  defp mode([r], false), do: "worktree_vs_" <> r
  defp mode([r], true), do: "index_vs_" <> r
  defp mode([a, b], _), do: a <> "_vs_" <> b

  # Cut on a valid UTF-8 boundary so the result stays a printable string.
  defp safe_cut(bin, n) do
    cut = binary_part(bin, 0, n)

    Enum.reduce_while(0..3, cut, fn i, _ ->
      c = binary_part(cut, 0, n - i)
      if String.valid?(c), do: {:halt, c}, else: {:cont, c}
    end)
  end

  # --numstat -z records:
  #   "<added>\t<deleted>\t<path>\0"
  #   "<added>\t<deleted>\t\0<old>\0<new>\0"   (rename/copy)
  # Binary files report "-" for both counts.
  defp parse_numstat(out), do: out |> String.split(<<0>>) |> do_numstat([])

  defp do_numstat([], acc), do: Enum.reverse(acc)
  defp do_numstat([""], acc), do: Enum.reverse(acc)

  defp do_numstat([rec | rest], acc) do
    case String.split(rec, "\t", parts: 3) do
      [a, d, ""] ->
        case rest do
          [old, new | rest2] -> do_numstat(rest2, [entry(a, d, new, old) | acc])
          _ -> Enum.reverse(acc)
        end

      [a, d, path] ->
        do_numstat(rest, [entry(a, d, path, nil) | acc])

      _ ->
        do_numstat(rest, acc)
    end
  end

  defp entry(a, d, path, orig) do
    binary = a == "-" and d == "-"

    %{
      "path" => path,
      "orig_path" => orig,
      "added" => if(binary, do: nil, else: to_int(a)),
      "deleted" => if(binary, do: nil, else: to_int(d)),
      "binary" => binary
    }
  end

  defp to_int(s) do
    case Integer.parse(s) do
      {n, _} -> n
      :error -> nil
    end
  end

  # --- git helper -----------------------------------------------------------

  defp git(cwd, argv) do
    case Cmd.run(%{"argv" => ["git" | argv], "cwd" => cwd, "timeout_ms" => 60_000}) do
      {:ok, r} ->
        case get(r, "status") do
          0 ->
            {:ok, get(r, "stdout") || ""}

          s ->
            {:error,
             "git #{Enum.join(argv, " ")} failed (#{inspect(s)}): " <>
               String.trim((get(r, "stderr") || "") <> "\n" <> (get(r, "stdout") || ""))}
        end

      {:error, e} ->
        {:error, "git #{Enum.join(argv, " ")}: #{inspect(e)}"}
    end
  end

  defp get(map, key), do: Map.get(map, key) || Map.get(map, String.to_atom(key))

  # --- arg parsing ----------------------------------------------------------

  defp fetch_cwd(args) do
    cwd = args["cwd"] || args["repo"] || File.cwd!()
    if File.dir?(cwd), do: {:ok, cwd}, else: {:error, "not a directory: #{cwd}"}
  end

  defp fetch_paths(args) do
    case args["paths"] do
      nil -> {:ok, []}
      p when is_binary(p) and p != "" -> {:ok, [p]}
      l when is_list(l) ->
        if Enum.all?(l, &(is_binary(&1) and &1 != "")),
          do: {:ok, l},
          else: {:error, "paths must be a list of non-empty strings"}
      _ -> {:error, "paths must be a list of non-empty strings"}
    end
  end

  # Revisions go before "--", so a value starting with "-" would be read as an option.
  defp fetch_revs(args) do
    ref = args["ref"]
    to = args["to"]

    cond do
      to != nil and ref == nil -> {:error, "to requires ref"}
      not valid_rev?(ref) -> {:error, "ref must be a non-empty string not starting with '-'"}
      not valid_rev?(to) -> {:error, "to must be a non-empty string not starting with '-'"}
      true -> {:ok, Enum.reject([ref, to], &is_nil/1)}
    end
  end

  defp valid_rev?(nil), do: true

  defp valid_rev?(r) when is_binary(r),
    do: r != "" and not String.starts_with?(r, "-") and not String.contains?(r, <<0>>)

  defp valid_rev?(_), do: false

  defp fetch_int(args, key, default) do
    case args[key] do
      nil -> {:ok, default}
      n when is_integer(n) and n >= 0 -> {:ok, n}
      s when is_binary(s) ->
        case Integer.parse(s) do
          {n, ""} when n >= 0 -> {:ok, n}
          _ -> {:error, "#{key} must be a non-negative integer"}
        end
      _ -> {:error, "#{key} must be a non-negative integer"}
    end
  end

  defp truthy?(v), do: v in [true, "true", 1, "1"]
end