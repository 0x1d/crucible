defmodule AgentFn.Sys.Cmd do
  @moduledoc """
  Run an executable with an argv list (no shell interpolation).

  Args:
  - `argv` (required) — `[executable | args...]` non-empty list of strings
  - `cwd` — optional working directory
  - `timeout_ms` — optional timeout (default 30_000)
  - `env` — optional map of string env overrides
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    argv = Map.get(args, "argv") || Map.get(args, :argv)
    cwd = Map.get(args, "cwd") || Map.get(args, :cwd)
    timeout = Map.get(args, "timeout_ms") || Map.get(args, :timeout_ms) || 30_000
    env = Map.get(args, "env") || Map.get(args, :env) || %{}

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

      true ->
        [exe | rest] = argv

        env_list =
          env
          |> Map.new(fn {k, v} -> {to_string(k), to_string(v)} end)
          |> Map.to_list()

        opts =
          [stderr_to_stdout: false]
          |> maybe_put(:cd, cwd)
          |> maybe_put(:env, env_list)

        task =
          Task.async(fn ->
            System.cmd(exe, rest, opts)
          end)

        case Task.yield(task, timeout) || Task.shutdown(task, :brutal_kill) do
          {:ok, {stdout, status}} ->
            {:ok,
             %{
               "argv" => argv,
               "stdout" => stdout,
               "stderr" => "",
               "status" => status,
               "timeout_ms" => timeout
             }}

          nil ->
            {:error, "command timed out after #{timeout}ms"}

          {:exit, reason} ->
            {:error, "command failed: #{inspect(reason)}"}
        end
    end
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, _key, ""), do: opts
  defp maybe_put(opts, _key, []), do: opts
  defp maybe_put(opts, key, value), do: Keyword.put(opts, key, value)
end