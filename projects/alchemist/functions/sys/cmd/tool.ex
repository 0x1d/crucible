defmodule AgentFn.Sys.Cmd do
  @moduledoc """
  Run an executable with an argv list (no shell interpolation).

  Args:
  - `argv` (required) — `[executable | args...]` non-empty list of strings
  - `cwd` — optional working directory
  - `timeout_ms` — optional timeout (default 30_000)
  - `env` — optional map of string env overrides
  - `merge_stderr` — optional boolean; when true stderr is interleaved into
    `stdout` and `stderr` is `""` (default false)

  Returns `argv`, `stdout`, `stderr`, `status`, `timeout_ms`.
  stderr is captured separately: the executable is exec'd by `/bin/sh` with
  fd 2 redirected to a temp file. argv entries are passed as positional
  parameters (`"$@"`), never interpolated into the script.
  """
  @behaviour AgentFn.Tool

  # $0 is the executable, "$@" the args, $ALCHEMIST_SYS_CMD_STDERR the capture file.
  @wrapper ~S(exec "$0" "$@" 2>"$ALCHEMIST_SYS_CMD_STDERR")
  @stderr_var "ALCHEMIST_SYS_CMD_STDERR"
  @type args :: %{
    required(:argv) => [String.t()],
    optional(:cwd) => String.t(),
    optional(:env) => map(),
    optional(:merge_stderr) => boolean(),
    optional(:timeout_ms) => non_neg_integer()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    argv = get(args, "argv")
    cwd = get(args, "cwd")
    timeout = get(args, "timeout_ms") || 30_000
    env = get(args, "env") || %{}
    merge? = get(args, "merge_stderr") == true

    cond do
      not is_list(argv) or argv == [] ->
        {:error, "argv must be a non-empty list"}

      not Enum.all?(argv, &is_binary/1) ->
        {:error, "argv entries must be strings"}

      not is_integer(timeout) or timeout <= 0 ->
        {:error, "timeout_ms must be a positive integer"}

      is_binary(cwd) and cwd != "" and not File.dir?(cwd) ->
        {:error, "cwd is not a directory: #{cwd}"}

      not is_map(env) ->
        {:error, "env must be a map"}

      not executable?(hd(argv)) ->
        {:error, "executable not found: #{hd(argv)}"}

      true ->
        env_list = Enum.map(env, fn {k, v} -> {to_string(k), to_string(v)} end)
        exec(argv, cwd, env_list, timeout, merge?)
    end
  end

  defp exec(argv, cwd, env_list, timeout, true = _merge?) do
    [exe | rest] = argv
    opts = base_opts(cwd, env_list) |> Keyword.put(:stderr_to_stdout, true)

    with {:ok, {stdout, status}} <- run_task(fn -> System.cmd(exe, rest, opts) end, timeout) do
      {:ok, result(argv, stdout, "", status, timeout)}
    end
  end

  defp exec(argv, cwd, env_list, timeout, false = _merge?) do
    err_path =
      Path.join(
        System.tmp_dir!(),
        "alchemist-sys-cmd-#{System.pid()}-#{System.unique_integer([:positive])}.err"
      )

    opts = base_opts(cwd, [{@stderr_var, err_path} | env_list])

    try do
      with {:ok, {stdout, status}} <-
             run_task(fn -> System.cmd("/bin/sh", ["-c", @wrapper | argv], opts) end, timeout) do
        stderr =
          case File.read(err_path) do
            {:ok, data} -> data
            _ -> ""
          end

        {:ok, result(argv, stdout, stderr, status, timeout)}
      end
    after
      File.rm(err_path)
    end
  end

  defp run_task(fun, timeout) do
    task = Task.async(fun)

    case Task.yield(task, timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, value} -> {:ok, value}
      nil -> {:error, "command timed out after #{timeout}ms"}
      {:exit, reason} -> {:error, "command failed: #{inspect(reason)}"}
    end
  end

  defp result(argv, stdout, stderr, status, timeout) do
    %{
      "argv" => argv,
      "stdout" => stdout,
      "stderr" => stderr,
      "status" => status,
      "timeout_ms" => timeout
    }
  end

  defp base_opts(cwd, env_list) do
    []
    |> maybe_put(:cd, cwd)
    |> maybe_put(:env, env_list)
  end

  # Bare names must resolve on PATH; paths with a slash are checked by the OS.
  defp executable?(exe) do
    String.contains?(exe, "/") or System.find_executable(exe) != nil
  end

  defp get(map, key), do: Map.get(map, key) || Map.get(map, String.to_atom(key))

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, _key, ""), do: opts
  defp maybe_put(opts, _key, []), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)
end