defmodule Runtime.Server do
  @moduledoc """
  Serves codex protocol requests on one BEAM.

  The application supervisor starts three children. `Runtime.TaskSupervisor`
  holds a temporary task per TCP client. This GenServer only serializes
  `define` and `load`, because `Code.require_file/2` and
  `ignore_module_conflict` are unsafe to run concurrently. `accept/0` runs as
  a permanent task (`Runtime.Acceptor`). That task owns the loopback listen
  socket. It does not run `run/1`.

  Each accepted client is started with `Task.Supervisor.start_child/2`, then
  `:gen_tcp.controlling_process/2` moves the socket onto that task. The task
  reads one 4-byte length-prefixed JSON request, dispatches it, writes the
  response, and closes the socket. `call` runs `run/1` in the task. A crash
  there closes that socket and leaves the acceptor and this GenServer up.

  Accept errors exit the acceptor. The supervisor restarts it until the
  intensity limit (3 restarts in 5 seconds), then stops the application.
  The bridge starts that application as `:permanent`, so a stopped supervisor
  takes the VM down with it.

  `port` and `pid` files live in `ALCHEMIST_STATE_DIR` or `runtime/.alchemist`.
  """

  use GenServer

  @max_packet 10 * 1024 * 1024
  @listen_opts [
    :binary,
    packet: 4,
    active: false,
    reuseaddr: true,
    ip: {127, 0, 0, 1},
    packet_size: @max_packet,
    backlog: 64
  ]

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec port() :: :inet.port_number()
  def port, do: :persistent_term.get({__MODULE__, :port})

  @doc false
  def acceptor do
    Runtime.Supervisor
    |> Supervisor.which_children()
    |> Enum.find_value(fn
      {Runtime.Acceptor, pid, _, _} when is_pid(pid) -> pid
      _ -> nil
    end)
  end

  @doc false
  def serialize(fun) when is_function(fun, 0) do
    GenServer.call(__MODULE__, {:serialize, fun}, :infinity)
  end

  @doc """
  Bind the loopback listen socket and accept until the socket fails.

  Runs in the permanent `Runtime.Acceptor` task, not in this GenServer.
  """
  def accept do
    listen = open_listen!()

    try do
      {:ok, port} = :inet.port(listen)
      publish!(port)
      accept_loop(listen)
    after
      :gen_tcp.close(listen)
    end
  end

  @doc false
  def accept_loop(listen) do
    case :gen_tcp.accept(listen) do
      {:ok, socket} ->
        handoff(socket)
        accept_loop(listen)

      {:error, :closed} ->
        exit(:shutdown)

      {:error, reason} ->
        exit(reason)
    end
  end

  @doc false
  def clear_state do
    :persistent_term.erase({__MODULE__, :port})
    dir = state_dir()
    _ = File.rm(Path.join(dir, "port"))
    _ = File.rm(Path.join(dir, "pid"))
    :ok
  end

  @impl true
  def init(_opts), do: {:ok, %{}}

  @impl true
  def handle_call({:serialize, fun}, _from, state) do
    {:reply, Runtime.Result.wrap(fun), state}
  end

  defp handoff(socket) do
    {:ok, pid} =
      Task.Supervisor.start_child(Runtime.TaskSupervisor, fn ->
        receive do
          {:socket, client} -> serve(client)
        after
          5_000 -> :ok
        end
      end)

    case :gen_tcp.controlling_process(socket, pid) do
      :ok ->
        send(pid, {:socket, socket})

      {:error, reason} ->
        :gen_tcp.close(socket)
        Process.exit(pid, :kill)
        exit(reason)
    end
  end

  defp serve(socket) do
    try do
      response = read_request(socket)
      _ = :gen_tcp.send(socket, Jason.encode!(response))
    after
      :gen_tcp.close(socket)
    end
  end

  defp read_request(socket) do
    case :gen_tcp.recv(socket, 0, 120_000) do
      {:ok, data} -> decode_request(data)
      {:error, reason} -> %{ok: false, error: "socket recv failed: #{inspect(reason)}"}
    end
  end

  defp decode_request(data) do
    case Jason.decode(data) do
      {:ok, request} when is_map(request) -> dispatch(request)
      {:ok, _} -> %{ok: false, error: "request must be a JSON object"}
      {:error, _} -> %{ok: false, error: "invalid JSON"}
    end
  end

  defp dispatch(request) do
    Runtime.Result.wrap(fn -> route(request) end)
  end

  defp route(%{"op" => op} = request) when op in ["define", "load"] do
    serialize(fn -> Runtime.CLI.dispatch(request) end)
  end

  defp route(request), do: Runtime.CLI.dispatch(request)

  defp open_listen! do
    case :gen_tcp.listen(preferred_port(), @listen_opts) do
      {:ok, listen} ->
        listen

      {:error, _reason} ->
        {:ok, listen} = :gen_tcp.listen(0, @listen_opts)
        listen
    end
  end

  defp preferred_port do
    path = Path.join(state_dir(), "port")

    case File.read(path) do
      {:ok, contents} ->
        case Integer.parse(String.trim(contents)) do
          {port, ""} when port > 0 and port < 65_536 -> port
          _ -> 0
        end

      _ ->
        0
    end
  end

  defp publish!(port) do
    :persistent_term.put({__MODULE__, :port}, port)
    dir = state_dir()
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "port"), Integer.to_string(port))
    File.write!(Path.join(dir, "pid"), System.pid())
  end

  defp state_dir do
    case System.get_env("ALCHEMIST_STATE_DIR") do
      dir when is_binary(dir) and dir != "" -> Path.expand(dir)
      _ -> Path.expand(".alchemist", File.cwd!())
    end
  end
end
