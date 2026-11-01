defmodule Runtime.CodexWarmup do
  @moduledoc """
  Compiles every codex entry under `AGENT_FUNCTIONS_DIR` before the acceptor listens.

  Connection tasks can invoke `run/1` without per-call compile or cross-slug races.
  New or edited entries still go through `define` / `load` (with reload).
  """

  use GenServer

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Runtime.Engine.warm_load_all!()
    {:ok, %{}}
  end
end
