defmodule AgentFn.Runtime.BounceMemory do
  @moduledoc "Stop `Runtime.Memory` so OTP restarts it (reloads MiniGraf server)."
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    case Process.whereis(Runtime.Memory) do
      nil ->
        {:ok, %{"restarted" => false, "reason" => "Runtime.Memory not running"}}

      pid ->
        ref = Process.monitor(pid)
        _ = GenServer.stop(pid, :normal, 10_000)

        receive do
          {:DOWN, ^ref, :process, ^pid, _} -> :ok
        after
          10_000 -> :ok
        end

        ready =
          Enum.find_value(1..100, fn _ ->
            case Process.whereis(Runtime.Memory) do
              new when is_pid(new) and new != pid -> new
              _ ->
                Process.sleep(100)
                nil
            end
          end)

        if is_pid(ready) do
          {:ok, %{"restarted" => true, "pid" => inspect(ready)}}
        else
          {:error, "Runtime.Memory did not come back after stop"}
        end
    end
  end
end