defmodule AgentFn.Github.CreatePr do
  @moduledoc """
  Create a GitHub pull request, or return a compare URL if `gh` cannot run.

  Flow:
  1. Resolve repo `cwd`, head branch, base (default `main`), and `origin` URL
  2. Build a web compare URL from the remote
  3. If `gh` is missing / auth fails / create fails — return `compare_url` and stop
     (do **not** search the filesystem for a `gh` binary)
  4. Otherwise create (or reuse an open PR for that head) and return `url`

  Args:
  - `cwd` / `repo` (required) — git repository root
  - `base` — base branch (default `main`)
  - `head` — head branch (default: current branch in `cwd`)
  - `title` — PR title (optional; uses `gh pr create --fill` when omitted with body)
  - `body` — PR body (optional)
  - `draft` — when true, create as draft
  - `dry_run` — when true, do not call `gh`; return planned fields + `compare_url`
  - `timeout_ms` — forwarded to `sys.cmd` (default 60_000)

  Result always includes `head`, `base`, `cwd`, and `compare_url` when derivable.
  On success with `gh`: `url` (and `created` / `existing`).
  On soft failure: `ok` => false, `error`, `message`, plus `compare_url`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:base) => String.t(),
    optional(:body) => String.t(),
    optional(:cwd) => String.t(),
    optional(:draft) => boolean(),
    optional(:dry_run) => boolean(),
    optional(:head) => String.t(),
    optional(:repo) => String.t(),
    optional(:timeout_ms) => non_neg_integer(),
    optional(:title) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    timeout = get(args, "timeout_ms") || 60_000

    with {:ok, cwd} <- require_cwd(args),
         {:ok, head} <- resolve_head(args, cwd, timeout),
         base <- get(args, "base") || "main",
         {:ok, remote} <- git_stdout(cwd, ["remote", "get-url", "origin"], timeout),
         compare_url <- compare_url(remote, base, head) do
      base_out = %{
        "cwd" => cwd,
        "head" => head,
        "base" => base,
        "remote" => String.trim(remote),
        "compare_url" => compare_url
      }

      cond do
        truthy?(get(args, "dry_run")) ->
          {:ok, Map.merge(base_out, %{"ok" => true, "dry_run" => true})}

        System.find_executable("gh") == nil ->
          {:ok,
           Map.merge(base_out, %{
             "ok" => false,
             "error" => "gh_not_found",
             "message" =>
               "gh is not on PATH. Open the compare_url in a browser, or install GitHub CLI and retry."
           })}

        true ->
          create_or_reuse(args, cwd, base, head, timeout, base_out)
      end
    end
  end

  defp create_or_reuse(args, cwd, base, head, timeout, base_out) do
    case existing_pr(cwd, head, timeout) do
      {:ok, url} when is_binary(url) and url != "" ->
        {:ok, Map.merge(base_out, %{"ok" => true, "url" => url, "existing" => true})}

      _ ->
        case create_pr(args, cwd, base, head, timeout) do
          {:ok, url} ->
            {:ok, Map.merge(base_out, %{"ok" => true, "url" => url, "created" => true})}

          {:error, message} ->
            {:ok,
             Map.merge(base_out, %{
               "ok" => false,
               "error" => "gh_failed",
               "message" => message
             })}
        end
    end
  end

  defp existing_pr(cwd, head, timeout) do
    argv = [
      "gh",
      "pr",
      "list",
      "--head",
      head,
      "--state",
      "open",
      "--json",
      "url",
      "--limit",
      "1"
    ]

    case cmd(argv, cwd, timeout) do
      {:ok, out} ->
        case Jason.decode(out) do
          {:ok, [%{"url" => url} | _]} when is_binary(url) -> {:ok, url}
          {:ok, []} -> {:error, :none}
          _ -> {:error, :parse}
        end

      {:error, _} = err ->
        err
    end
  end

  defp create_pr(args, cwd, base, head, timeout) do
    title = get(args, "title")
    body = get(args, "body")
    draft? = truthy?(get(args, "draft"))

    argv =
      ["gh", "pr", "create", "--base", base, "--head", head]
      |> maybe_flag(draft?, "--draft")
      |> maybe_title_body(title, body)

    case cmd(argv, cwd, timeout) do
      {:ok, out} ->
        url =
          out
          |> String.split("\n", trim: true)
          |> Enum.reverse()
          |> Enum.find(&String.starts_with?(&1, "http"))

        if is_binary(url), do: {:ok, url}, else: {:ok, String.trim(out)}

      {:error, msg} ->
        {:error, msg}
    end
  end

  defp maybe_flag(argv, true, flag), do: argv ++ [flag]
  defp maybe_flag(argv, _, _), do: argv

  defp maybe_title_body(argv, title, body)
       when is_binary(title) and title != "" and is_binary(body) do
    argv ++ ["--title", title, "--body", body]
  end

  defp maybe_title_body(argv, title, _body) when is_binary(title) and title != "" do
    argv ++ ["--title", title, "--body", ""]
  end

  defp maybe_title_body(argv, _title, body) when is_binary(body) and body != "" do
    argv ++ ["--fill", "--body", body]
  end

  defp maybe_title_body(argv, _, _), do: argv ++ ["--fill"]

  defp require_cwd(args) do
    cwd = get(args, "cwd") || get(args, "repo")

    cond do
      not is_binary(cwd) or String.trim(cwd) == "" ->
        {:error, "cwd (or repo) is required"}

      not File.dir?(cwd) ->
        {:error, "cwd is not a directory: #{cwd}"}

      not File.dir?(Path.join(cwd, ".git")) and not File.exists?(Path.join(cwd, ".git")) ->
        {:error, "cwd is not a git repository: #{cwd}"}

      true ->
        {:ok, cwd}
    end
  end

  defp resolve_head(args, cwd, timeout) do
    case get(args, "head") do
      head when is_binary(head) and head != "" ->
        {:ok, head}

      _ ->
        git_stdout(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], timeout)
    end
  end

  defp git_stdout(cwd, git_args, timeout) do
    case cmd(["git" | git_args], cwd, timeout) do
      {:ok, out} -> {:ok, out}
      {:error, msg} -> {:error, "git #{Enum.join(git_args, " ")}: #{msg}"}
    end
  end

  defp cmd(argv, cwd, timeout) do
    case AgentFn.Sys.Cmd.run(%{"argv" => argv, "cwd" => cwd, "timeout_ms" => timeout}) do
      {:ok, %{"status" => 0, "stdout" => out}} ->
        {:ok, String.trim_trailing(out)}

      {:ok, %{"status" => status, "stdout" => out}} ->
        {:error, "exit #{status}: #{String.trim(out)}"}

      {:error, msg} ->
        {:error, msg}
    end
  end

  defp compare_url(remote, base, head) do
    case parse_remote(remote) do
      {:ok, host, owner, repo} ->
        "https://#{host}/#{owner}/#{repo}/compare/#{base}...#{head}"

      :error ->
        nil
    end
  end

  defp parse_remote(remote) when is_binary(remote) do
    remote = String.trim(remote) |> String.trim_trailing(".git")

    cond do
      String.starts_with?(remote, "git@") ->
        # git@host:owner/repo
        case Regex.run(~r/^git@([^:]+):(.+)$/, remote) do
          [_, host, path] -> split_owner_repo(host, path)
          _ -> :error
        end

      String.starts_with?(remote, "ssh://") ->
        case Regex.run(~r/^ssh:\/\/(?:git@)?([^\/]+)\/(.+)$/, remote) do
          [_, host, path] -> split_owner_repo(host, path)
          _ -> :error
        end

      String.starts_with?(remote, "http://") or String.starts_with?(remote, "https://") ->
        case Regex.run(~r/^https?:\/\/([^\/]+)\/(.+)$/, remote) do
          [_, host, path] -> split_owner_repo(host, path)
          _ -> :error
        end

      true ->
        :error
    end
  end

  defp split_owner_repo(host, path) do
    parts = path |> String.trim("/") |> String.split("/", trim: true)

    case parts do
      [owner, repo | _] -> {:ok, host, owner, repo}
      _ -> :error
    end
  end

  defp get(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, String.to_atom(key))
  end

  defp truthy?(v) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(_), do: false
end