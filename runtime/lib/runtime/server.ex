defmodule Runtime.Server do
  @moduledoc """
  Long-lived registry server. The OTP application listens on 127.0.0.1 and
  dispatches JSON ops inside this BEAM, so compiled modules stay loaded.
  """

  use GenServer

  @max_packet 10 * 1024 * 1024

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec port() :: :inet.port_number()
  def port, do: GenServer.call(__MODULE__, :port)

  @impl true
  def init(_opts) do
    Process.flag(:trap_exit, true)

    {:ok, listen} =
      :gen_tcp.listen(0, [
        :binary,
        packet: 4,
        active: false,
        reuseaddr: true,
        ip: {127, 0, 0, 1},
        packet_size: @max_packet,
        backlog: 64
      ])

    {:ok, port} = :inet.port(listen)
    write_state!(port)

    acceptor = spawn_link(fn -> accept_loop(listen) end)
    {:ok, %{listen: listen, port: port, acceptor: acceptor}}
  end

  @impl true
  def handle_call(:port, _from, state), do: {:reply, state.port, state}

  def handle_call({:dispatch, request}, _from, state) do
    response =
      try do
        Runtime.CLI.dispatch(request)
      rescue
        exception -> %{ok: false, error: Exception.message(exception)}
      catch
        :throw, {:error, message} -> %{ok: false, error: message}
      end

    {:reply, response, state}
  end

  @impl true
  def handle_info({:EXIT, pid, reason}, %{acceptor: pid} = state) do
    if reason == :normal do
      {:stop, :normal, state}
    else
      acceptor = spawn_link(fn -> accept_loop(state.listen) end)
      {:noreply, %{state | acceptor: acceptor}}
    end
  end

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    :gen_tcp.close(state.listen)
    remove_state()
    :ok
  end

  defp accept_loop(listen) do
    case :gen_tcp.accept(listen) do
      {:ok, socket} ->
        spawn(fn -> handle_socket(socket) end)
        accept_loop(listen)

      {:error, :closed} ->
        :ok

      {:error, _reason} ->
        accept_loop(listen)
    end
  end

  defp handle_socket(socket) do
    response =
      case :gen_tcp.recv(socket, 0, 120_000) do
        {:ok, data} ->
          case Jason.decode(data) do
            {:ok, request} when is_map(request) ->
              GenServer.call(__MODULE__, {:dispatch, request}, :infinity)

            {:ok, _} ->
              %{ok: false, error: "request must be a JSON object"}

            {:error, _} ->
              %{ok: false, error: "invalid JSON"}
          end

        {:error, reason} ->
          %{ok: false, error: "socket recv failed: #{inspect(reason)}"}
      end

    _ = :gen_tcp.send(socket, Jason.encode!(response))
    :gen_tcp.close(socket)
  end

  defp write_state!(port) do
    dir = state_dir()
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "port"), Integer.to_string(port))
    File.write!(Path.join(dir, "pid"), System.pid())
  end

  defp remove_state do
    dir = state_dir()
    _ = File.rm(Path.join(dir, "port"))
    _ = File.rm(Path.join(dir, "pid"))
    :ok
  end

  defp state_dir do
    case System.get_env("ALCHEMIST_STATE_DIR") do
      dir when is_binary(dir) and dir != "" -> Path.expand(dir)
      _ -> Path.expand(".alchemist", File.cwd!())
    end
  end
end
