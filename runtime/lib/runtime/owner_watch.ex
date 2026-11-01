defmodule Runtime.OwnerWatch do
  @moduledoc """
  Stops the VM after its Node owner exits.

  The bridge sets `ALCHEMIST_OWNER_PID` for local dev, evals, and the CLI.
  A second Ctrl+C can kill that process before its shutdown hook runs.
  This process polls the owner and calls `:init.stop/0` once the pid is gone.
  Hosted detached VMs leave the variable unset, and this child does not start.
  """

  use GenServer

  @check_ms 200

  def start_link(_opts) do
    case status() do
      :alive -> GenServer.start_link(__MODULE__, owner_pid(), name: __MODULE__)
      _ -> :ignore
    end
  end

  @spec status() :: :absent | :alive | :dead
  def status do
    case owner_pid() do
      nil -> :absent
      pid -> if alive?(pid), do: :alive, else: :dead
    end
  end

  @spec alive?(pos_integer()) :: boolean()
  def alive?(pid) when is_integer(pid) and pid > 0 do
    cond do
      File.dir?("/proc") -> proc_alive?(pid)
      true -> kill_alive?(pid)
    end
  end

  @impl true
  def init(pid) do
    send(self(), :check)
    {:ok, pid}
  end

  @impl true
  def handle_info(:check, pid) do
    if alive?(pid) do
      Process.send_after(self(), :check, @check_ms)
      {:noreply, pid}
    else
      :init.stop()
      {:noreply, pid}
    end
  end

  defp owner_pid do
    case System.get_env("ALCHEMIST_OWNER_PID") do
      value when is_binary(value) ->
        case Integer.parse(String.trim(value)) do
          {pid, ""} when pid > 0 -> pid
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp proc_alive?(pid) do
    case File.read("/proc/#{pid}/stat") do
      {:ok, stat} -> not zombie?(stat)
      _ -> false
    end
  end

  defp zombie?(stat) do
    case :binary.match(stat, ") ") do
      {pos, 2} -> binary_part(stat, pos + 2, 1) == "Z"
      _ -> false
    end
  end

  defp kill_alive?(pid) do
    case System.cmd("kill", ["-0", Integer.to_string(pid)], stderr_to_stdout: true) do
      {_, 0} -> true
      _ -> false
    end
  end
end
