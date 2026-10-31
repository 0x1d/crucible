defmodule Runtime.Memory do
  @moduledoc """
  Belief graph for the codex runtime.

  The application supervisor starts this GenServer before the acceptor.
  It replays `memory/graph.log` (or `AGENT_MEMORY_PATH`) and serializes writes.
  Codex entries call `transact/1`, `retract/1`, `query/1`, and `recall/1`.
  """

  use GenServer

  alias Runtime.Memory.Log

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec transact(map()) :: {:ok, map()} | {:error, String.t()}
  def transact(attrs) when is_map(attrs), do: GenServer.call(__MODULE__, {:transact, attrs})

  @spec retract(map()) :: {:ok, map()} | {:error, String.t()}
  def retract(attrs) when is_map(attrs), do: GenServer.call(__MODULE__, {:retract, attrs})

  @spec query(map()) :: {:ok, map()} | {:error, String.t()}
  def query(attrs) when is_map(attrs), do: GenServer.call(__MODULE__, {:query, attrs})

  @spec recall(map()) :: {:ok, map()} | {:error, String.t()}
  def recall(attrs) when is_map(attrs), do: GenServer.call(__MODULE__, {:recall, attrs})

  @doc false
  @spec reset!(String.t()) :: :ok
  def reset!(path) when is_binary(path) do
    GenServer.call(__MODULE__, {:reset, Path.expand(path)})
  end

  @impl true
  def init(_opts) do
    case Log.open(configured_path()) do
      {:ok, state} -> {:ok, state}
      {:error, reason} -> {:stop, reason}
    end
  end

  @impl true
  def handle_call({:transact, attrs}, _from, state), do: reply(Log.transact(state, attrs), state)

  def handle_call({:retract, attrs}, _from, state), do: reply(Log.retract(state, attrs), state)

  def handle_call({:query, attrs}, _from, state) do
    {:reply, Log.query(state, attrs), state}
  end

  def handle_call({:recall, attrs}, _from, state) do
    {:reply, Log.recall(state, attrs), state}
  end

  def handle_call({:reset, path}, _from, state) do
    Log.close(state)

    case Log.open(path) do
      {:ok, fresh} -> {:reply, :ok, fresh}
      {:error, reason} -> {:stop, reason, {:error, reason}, state}
    end
  end

  defp reply({:ok, new_state, result}, _state), do: {:reply, {:ok, result}, new_state}
  defp reply({:error, reason}, state), do: {:reply, {:error, reason}, state}

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
        Path.join(Path.dirname(Path.expand(dir)), "memory/graph.log")

      _ ->
        Path.expand("../../../memory/graph.log", __DIR__)
    end
  end
end
