defmodule Runtime.Memory do
  @moduledoc """
  Memory for the codex runtime.

  The application supervisor starts this GenServer before the acceptor.
  It owns one Node process, and that process keeps a single MiniGraf
  database open at `memory/minigraf.graph` or `AGENT_MEMORY_PATH`.
  Codex entries call `transact/1`, `retract/1`, `query/1`, and `overview/1`.
  """

  use GenServer

  @call_timeout 30_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec transact(map()) :: {:ok, map()} | {:error, String.t()}
  def transact(attrs) when is_map(attrs) do
    GenServer.call(__MODULE__, {:transact, attrs}, @call_timeout)
  end

  @spec retract(map()) :: {:ok, map()} | {:error, String.t()}
  def retract(attrs) when is_map(attrs) do
    GenServer.call(__MODULE__, {:retract, attrs}, @call_timeout)
  end

  @spec query(map()) :: {:ok, map()} | {:error, String.t()}
  def query(attrs) when is_map(attrs) do
    GenServer.call(__MODULE__, {:query, attrs}, @call_timeout)
  end

  @spec overview(map()) :: {:ok, map()} | {:error, String.t()}
  def overview(attrs) when is_map(attrs) do
    GenServer.call(__MODULE__, {:overview, attrs}, @call_timeout)
  end

  @doc false
  @spec reset!(String.t()) :: :ok | {:error, String.t()}
  def reset!(path) when is_binary(path) do
    case GenServer.call(__MODULE__, {:reset, Path.expand(path)}, @call_timeout) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @impl true
  def init(_opts) do
    path = configured_path()

    case open_port(path) do
      {:ok, port} ->
        {:ok, %{port: port, path: path, buffer: "", next_id: 1, pending: %{}}}

      {:error, reason} ->
        {:stop, reason}
    end
  end

  @impl true
  def handle_call({op, attrs}, from, state)
      when op in [:transact, :retract, :query, :overview] do
    request(state, Atom.to_string(op), %{"args" => attrs}, from, nil)
  end

  def handle_call({:reset, path}, from, state) do
    request(state, "reset", %{"path" => path}, from, path)
  end

  @impl true
  def handle_info({port, {:data, {:noeol, part}}}, %{port: port} = state) do
    {:noreply, %{state | buffer: state.buffer <> text(part)}}
  end

  def handle_info({port, {:data, {:eol, part}}}, %{port: port} = state) do
    {:noreply, deliver(%{state | buffer: ""}, state.buffer <> text(part))}
  end

  def handle_info({port, {:exit_status, status}}, %{port: port} = state) do
    Enum.each(state.pending, fn {_id, pending} ->
      GenServer.reply(pending.from, {:error, "minigraf exited #{status}"})
    end)

    {:stop, :minigraf_exit, %{state | pending: %{}}}
  end

  @impl true
  def terminate(_reason, %{port: port}) do
    if Port.info(port) do
      _ = Port.close(port)
    end

    :ok
  end

  defp request(state, op, fields, from, reset_path) do
    id = state.next_id
    payload = fields |> Map.put("id", id) |> Map.put("op", op) |> Jason.encode!()

    case Port.command(state.port, [payload, ?\n]) do
      true ->
        pending = Map.put(state.pending, id, %{from: from, path: reset_path})
        {:noreply, %{state | next_id: id + 1, pending: pending}}

      false ->
        {:reply, {:error, "minigraf is not running"}, state}
    end
  end

  defp deliver(state, line) do
    with {:ok, message} <- Jason.decode(text(line)),
         id when is_integer(id) <- message["id"],
         %{from: from, path: reset_path} <- Map.get(state.pending, id) do
      reply =
        if message["ok"] do
          {:ok, message["result"]}
        else
          {:error, message["error"] || "memory request failed"}
        end

      GenServer.reply(from, reply)
      pending = Map.delete(state.pending, id)
      path = if message["ok"] && is_binary(reset_path), do: reset_path, else: state.path
      %{state | pending: pending, path: path}
    else
      _ -> state
    end
  end

  defp open_port(path) do
    with {:ok, node} <- find_node(),
         {:ok, script} <- find_script() do
      port =
        Port.open({:spawn_executable, node}, [
          :binary,
          :exit_status,
          :use_stdio,
          {:args, ["--experimental-strip-types", script, path]},
          {:line, 1_000_000}
        ])

      wait_ready(port)
    end
  end

  defp wait_ready(port) do
    receive do
      {^port, {:data, {:eol, line}}} ->
        case Jason.decode(text(line)) do
          {:ok, %{"ready" => true}} -> {:ok, port}
          {:ok, %{"error" => reason}} when is_binary(reason) -> {:error, reason}
          _ -> {:error, "minigraf failed to start"}
        end

      {^port, {:exit_status, status}} ->
        {:error, "minigraf exited #{status}"}
    after
      15_000 ->
        {:error, "minigraf failed to start"}
    end
  end

  defp text(data) when is_binary(data), do: data
  defp text(data) when is_list(data), do: List.to_string(data)

  defp find_node do
    case System.find_executable("node") do
      node when is_binary(node) -> {:ok, node}
      _ -> {:error, "node is required to open memory"}
    end
  end

  defp find_script do
    script = Path.expand("../../../core/minigraf-server.ts", __DIR__)

    if File.regular?(script) do
      {:ok, script}
    else
      {:error, "minigraf server is missing"}
    end
  end

  defp configured_path do
    env = System.get_env("AGENT_MEMORY_PATH")

    cond do
      is_binary(env) and env != "" ->
        Path.expand(env)

      path = Application.get_env(:runtime, :memory_path) ->
        Path.expand(path)

      true ->
        default_path()
    end
  end

  defp default_path do
    case System.get_env("AGENT_FUNCTIONS_DIR") do
      dir when is_binary(dir) and dir != "" ->
        Path.join(Path.dirname(Path.expand(dir)), "memory/minigraf.graph")

      _ ->
        Path.expand("../../../memory/minigraf.graph", __DIR__)
    end
  end
end
