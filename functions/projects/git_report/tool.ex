defmodule AgentFn.Projects.GitReport do
  @moduledoc """
  Scan a root directory for project folders and report git status for each.

  Args:
  - `root` — directory to scan (default `/home/master/src`)
  - `max_depth` — how deep to search for `.git` (default 2)
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:max_depth) => non_neg_integer(),
    optional(:root) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) do
    root = Map.get(args, "root", "/home/master/src")
    max_depth = Map.get(args, "max_depth", 2)

    case File.stat(root) do
      {:ok, %{type: :directory}} ->
        projects =
          find_git_repos(root, max_depth)
          |> Enum.sort()
          |> Enum.map(&repo_status/1)

        {:ok,
         %{
           root: root,
           count: length(projects),
           projects: projects,
           generated_at: DateTime.utc_now() |> DateTime.to_iso8601()
         }}

      {:ok, _} ->
        {:error, "#{root} is not a directory"}

      {:error, reason} ->
        {:error, "cannot access #{root}: #{inspect(reason)}"}
    end
  end

  defp find_git_repos(root, max_depth) do
    do_find(root, 0, max_depth, [])
  end

  defp do_find(_path, depth, max_depth, acc) when depth > max_depth, do: acc

  defp do_find(path, depth, max_depth, acc) do
    git_dir = Path.join(path, ".git")

    cond do
      File.exists?(git_dir) ->
        [path | acc]

      depth == max_depth ->
        acc

      true ->
        case File.ls(path) do
          {:ok, entries} ->
            entries
            |> Enum.reject(&hidden?/1)
            |> Enum.reduce(acc, fn name, a ->
              child = Path.join(path, name)

              case File.stat(child) do
                {:ok, %{type: :directory}} ->
                  do_find(child, depth + 1, max_depth, a)

                _ ->
                  a
              end
            end)

          {:error, _} ->
            acc
        end
    end
  end

  defp hidden?(name), do: String.starts_with?(name, ".")

  defp repo_status(path) do
    branch = git(path, ["rev-parse", "--abbrev-ref", "HEAD"])
    short = git(path, ["status", "--short"])
    porcelain = git(path, ["status", "--porcelain=v1", "-b"])
    remotes = git(path, ["remote", "-v"])
    last = git(path, ["log", "-1", "--format=%h %s (%cr)"])

    dirty_lines =
      short
      |> String.split("\n", trim: true)
      |> Enum.reject(&(&1 == ""))

    %{
      path: path,
      name: Path.basename(path),
      branch: String.trim(branch),
      clean: dirty_lines == [],
      dirty_count: length(dirty_lines),
      status_short: dirty_lines,
      status_branch: String.trim(porcelain) |> String.split("\n", trim: true) |> List.first(),
      remotes: remotes |> String.split("\n", trim: true) |> Enum.reject(&(&1 == "")),
      last_commit: String.trim(last)
    }
  end

  defp git(cwd, args) do
    case System.cmd("git", args, cd: cwd, stderr_to_stdout: true) do
      {out, 0} -> out
      {out, _} -> String.trim(out)
    end
  rescue
    e -> "error: #{Exception.message(e)}"
  end
end