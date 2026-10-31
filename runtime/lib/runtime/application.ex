defmodule Runtime.Application do
  @moduledoc """
  OTP application entry for the Alchemist codex runtime (`:runtime`).

  Starts the task supervisor, compile serializer (`Runtime.Server`), and the
  permanent acceptor task that owns the loopback listen socket.
  """

  use Application

  @impl true
  def start(_type, _args) do
    opts = [
      strategy: :one_for_one,
      name: Runtime.Supervisor,
      max_restarts: 3,
      max_seconds: 5
    ]

    case Supervisor.start_link(children(), opts) do
      {:ok, pid} ->
        case wait_until_listening(5_000) do
          :ok ->
            {:ok, pid}

          {:error, reason} ->
            Supervisor.stop(pid)
            {:error, reason}
        end

      other ->
        other
    end
  end

  @impl true
  def stop(_state) do
    Runtime.Server.clear_state()
    :ok
  end

  @doc """
  Supervision order: connection tasks, then the compile serializer, then the
  permanent acceptor. Shutdown stops children in reverse, so the listen socket
  closes before in-flight connection tasks.
  """
  def children do
    [
      {Task.Supervisor, name: Runtime.TaskSupervisor},
      Runtime.Server,
      Supervisor.child_spec(
        {Task, &Runtime.Server.accept/0},
        id: Runtime.Acceptor,
        restart: :permanent
      )
    ]
  end

  defp wait_until_listening(timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    wait(deadline)
  end

  defp wait(deadline) do
    if :persistent_term.get({Runtime.Server, :port}, nil) do
      :ok
    else
      cond do
        System.monotonic_time(:millisecond) > deadline ->
          {:error, :acceptor_did_not_listen}

        Process.whereis(Runtime.Supervisor) == nil ->
          {:error, :supervisor_stopped}

        true ->
          Process.sleep(10)
          wait(deadline)
      end
    end
  end
end
