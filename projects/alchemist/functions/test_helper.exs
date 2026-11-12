# Test helper for codex entry tests (functions/**/test/*_test.exs).
#
# Run from runtime/:
#
#     ALCHEMIST_TEST_SCOPE=functions mix test
#
# runtime/mix.exs sets AGENT_FUNCTIONS_DIR and an isolated ALCHEMIST_STATE_DIR
# before the application starts, so every entry is already warm-loaded here.

defmodule FunctionsTest.Git do
  @moduledoc "Helpers for tests that need throwaway git repositories."

  @doc "Creates an empty repo on `main` with a local identity; returns its path."
  def tmp_repo!(prefix \\ "repo") do
    dir = Path.join(System.tmp_dir!(), "#{prefix}-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    git!(dir, ["init", "-q", "-b", "main"])
    git!(dir, ["config", "user.email", "test@example.com"])
    git!(dir, ["config", "user.name", "Test"])
    git!(dir, ["config", "commit.gpgsign", "false"])
    dir
  end

  @doc "Runs git in `dir`; raises on non-zero exit. Returns trimmed output."
  def git!(dir, args) do
    case System.cmd("git", args, cd: dir, stderr_to_stdout: true) do
      {out, 0} -> String.trim_trailing(out)
      {out, code} -> raise "git #{Enum.join(args, " ")} failed (#{code}): #{out}"
    end
  end

  @doc "Runs git in `dir`; returns `{output, exit_code}` without raising."
  def git(dir, args), do: System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  def write!(dir, rel, content) do
    path = Path.join(dir, rel)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, content)
  end

  def commit_all!(dir, msg) do
    git!(dir, ["add", "-A"])
    git!(dir, ["commit", "-q", "-m", msg])
  end

  def head!(dir), do: git!(dir, ["rev-parse", "HEAD"])
end

ExUnit.start()
