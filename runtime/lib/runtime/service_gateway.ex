defmodule Runtime.ServiceGateway do
  @moduledoc """
  Call-only listener for published services.

  A second TCP listener beside `Runtime.Server`, bound to `127.0.0.1`.
  Frames are the same as the codex socket: a 4-byte big-endian length, then
  a JSON body. A connection carries one request and one response.

  The only accepted request is

      {"op": "call", "name": "<service slug>", "args": {...}}

  Every other op is refused. The slug must be listed in the service manifest
  with the SHA-256 of the entry's current `tool.ex`
  (see `Runtime.ServiceGateway.Registry`). The call validates `args` against
  `service.input_schema`, runs `run/1` in a task under
  `Runtime.ServiceGateway.Tasks` with a timeout and a `max_heap_size`, and
  validates the result against `service.output_schema`.

  Responses are `{"ok": true, "result": {...}}` or
  `{"ok": false, "code": "<code>", "error": "<message>"}`.

  Supervision: `Runtime.ServiceGateway` is a supervisor of
  `Runtime.ServiceGateway.Tasks` (a `Task.Supervisor`) and
  `Runtime.ServiceGateway.Listener` (owns the listen socket and the acceptor).
  The listener writes its port to `gateway_port` in the state directory and
  removes it on shutdown.

  Configuration (options, then environment):

  - `:port` / `ALCHEMIST_GATEWAY_PORT` (default `0`, an ephemeral port)
  - `:state_dir` / `ALCHEMIST_STATE_DIR` (default `.alchemist` under the cwd)
  - `:manifest_path` / `ALCHEMIST_SERVICE_MANIFEST` (default `services.json` in the state directory)
  - `:functions_root` (default `Runtime.Codex.functions_root/0`)
  - `:timeout_ms` / `ALCHEMIST_SERVICE_TIMEOUT_MS` (default `5000`)
  - `:max_heap_words` / `ALCHEMIST_SERVICE_MAX_HEAP_WORDS` (default `4_000_000` words)
  """

  use Supervisor

  alias Runtime.ServiceGateway.{Registry, Schema}

  @default_timeout_ms 5_000
  @default_max_heap_words 4_000_000

  @type config :: %{
          port: non_neg_integer(),
          state_dir: String.t(),
          manifest_path: String.t(),
          functions_root: String.t(),
          timeout_ms: pos_integer(),
          max_heap_words: pos_integer(),
          tasks: atom(),
          listener: atom()
        }

  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    Supervisor.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    config = config(opts)

    children = [
      {Task.Supervisor, name: config.tasks},
      {Runtime.ServiceGateway.Listener, config}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end

  @doc "Port the listener is bound to."
  @spec port(atom() | pid()) :: :inet.port_number()
  def port(listener \\ Runtime.ServiceGateway.Listener),
    do: Runtime.ServiceGateway.Listener.port(listener)

  @doc "Build the configuration from options and the environment."
  @spec config(keyword()) :: config()
  def config(opts \\ []) do
    state_dir =
      opt(opts, :state_dir, "ALCHEMIST_STATE_DIR") || Path.expand(".alchemist", File.cwd!())

    %{
      port: int(opt(opts, :port, "ALCHEMIST_GATEWAY_PORT"), 0),
      state_dir: Path.expand(state_dir),
      manifest_path:
        Path.expand(
          opt(opts, :manifest_path, "ALCHEMIST_SERVICE_MANIFEST") ||
            Path.join(state_dir, "services.json")
        ),
      functions_root: Path.expand(Keyword.get(opts, :functions_root) || Runtime.Codex.functions_root()),
      timeout_ms: int(opt(opts, :timeout_ms, "ALCHEMIST_SERVICE_TIMEOUT_MS"), @default_timeout_ms),
      max_heap_words:
        int(opt(opts, :max_heap_words, "ALCHEMIST_SERVICE_MAX_HEAP_WORDS"), @default_max_heap_words),
      tasks: Keyword.get(opts, :tasks, Runtime.ServiceGateway.Tasks),
      listener: Keyword.get(opts, :listener, Runtime.ServiceGateway.Listener)
    }
  end

  @doc """
  Handle one decoded request. Only `call` is accepted.
  """
  @spec handle(term(), config()) :: map()
  def handle(%{"op" => "call", "name" => slug} = request, config) when is_binary(slug) do
    args = Map.get(request, "args", %{})

    if is_map(args) do
      case call(slug, args, config) do
        {:ok, result} -> %{"ok" => true, "result" => result}
        {:error, code, message} -> failure(code, message)
      end
    else
      failure(:invalid_input, "args must be an object")
    end
  end

  def handle(%{"op" => "call"}, _config), do: failure(:bad_request, "name is required")
  def handle(%{"op" => op}, _config) when is_binary(op),
    do: failure(:op_refused, "the service gateway accepts only call, not #{op}")

  def handle(_request, _config), do: failure(:bad_request, "expected {\"op\":\"call\",\"name\":...,\"args\":{...}}")

  @doc "Resolve, validate, and run one published service."
  @spec call(String.t(), map(), config()) :: {:ok, term()} | {:error, atom(), String.t()}
  def call(slug, args, config) do
    with {:ok, service} <- Registry.resolve(slug, config.functions_root, config.manifest_path),
         :ok <- check(Schema.validate(args, service.input_schema), :invalid_input),
         :ok <- ensure_loaded(service),
         {:ok, result} <- run(service, args, config),
         {:ok, result} <- normalize(result),
         :ok <- check(Schema.validate(result, service.output_schema), :invalid_output) do
      {:ok, result}
    end
  end

  defp check(:ok, _code), do: :ok
  defp check({:error, messages}, code), do: {:error, code, Enum.join(messages, "; ")}

  defp ensure_loaded(%{module: module, slug: slug}) do
    if Code.ensure_loaded?(module) and function_exported?(module, :run, 1),
      do: :ok,
      else: {:error, :not_loaded, "service #{slug} is not compiled; load services.#{slug}"}
  end

  defp run(%{module: module}, args, config) do
    words = config.max_heap_words

    task =
      Task.Supervisor.async_nolink(config.tasks, fn ->
        Process.flag(:max_heap_size, %{size: words, kill: true, error_logger: false})
        module.run(args)
      end)

    case Task.yield(task, config.timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, {:ok, result}} -> {:ok, result}
      {:ok, {:error, message}} -> {:error, :failed, to_message(message)}
      {:ok, other} -> {:error, :failed, "run/1 must return {:ok, value} or {:error, message}, got #{inspect(other, limit: 5)}"}
      {:exit, :killed} -> {:error, :heap_exceeded, "service exceeded its heap limit"}
      {:exit, reason} -> {:error, :failed, "service crashed: #{Exception.format_exit(reason)}"}
      nil -> {:error, :timeout, "service timed out after #{config.timeout_ms} ms"}
    end
  end

  # Round-trip through JSON so the output schema sees what the caller will.
  defp normalize(result) do
    with {:ok, json} <- Jason.encode(result),
         {:ok, decoded} <- Jason.decode(json) do
      {:ok, decoded}
    else
      _ -> {:error, :invalid_output, "service result is not JSON-encodable"}
    end
  end

  defp failure(code, message), do: %{"ok" => false, "code" => Atom.to_string(code), "error" => message}

  defp to_message(message) when is_binary(message), do: message
  defp to_message(message), do: inspect(message)

  defp opt(opts, key, env) do
    case Keyword.fetch(opts, key) do
      {:ok, value} -> value
      :error -> blank_to_nil(System.get_env(env))
    end
  end

  defp blank_to_nil(nil), do: nil
  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value

  defp int(nil, default), do: default
  defp int(value, _default) when is_integer(value), do: value

  defp int(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {n, ""} -> n
      _ -> default
    end
  end
end

defmodule Runtime.ServiceGateway.Listener do
  @moduledoc """
  Owns the gateway's listen socket and its acceptor.
  Each accepted connection is served in a task under `Runtime.ServiceGateway.Tasks`.
  """

  use GenServer
  require Logger

  @max_frame 1_048_576
  @recv_timeout 30_000

  def start_link(config), do: GenServer.start_link(__MODULE__, config, name: config.listener)

  @spec port(atom() | pid()) :: :inet.port_number()
  def port(server \\ __MODULE__), do: GenServer.call(server, :port)

  @impl true
  def init(config) do
    Process.flag(:trap_exit, true)

    opts = [
      :binary,
      packet: 4,
      packet_size: @max_frame,
      active: false,
      reuseaddr: true,
      ip: {127, 0, 0, 1}
    ]

    case :gen_tcp.listen(config.port, opts) do
      {:ok, socket} ->
        {:ok, port} = :inet.port(socket)
        write_port_file(config.state_dir, port)
        acceptor = spawn_link(fn -> accept_loop(socket, config) end)
        {:ok, %{socket: socket, port: port, config: config, acceptor: acceptor}}

      {:error, reason} ->
        {:stop, {:listen_failed, reason}}
    end
  end

  @impl true
  def handle_call(:port, _from, state), do: {:reply, state.port, state}

  @impl true
  def handle_info({:EXIT, pid, reason}, %{acceptor: pid} = state),
    do: {:stop, {:acceptor_exited, reason}, state}

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    File.rm(port_file(state.config.state_dir))
    :gen_tcp.close(state.socket)
    :ok
  end

  defp accept_loop(socket, config) do
    case :gen_tcp.accept(socket) do
      {:ok, client} ->
        case Task.Supervisor.start_child(config.tasks, fn -> serve(client, config) end) do
          {:ok, pid} -> :gen_tcp.controlling_process(client, pid)
          _ -> :gen_tcp.close(client)
        end

        accept_loop(socket, config)

      {:error, :closed} ->
        :ok

      {:error, reason} ->
        Logger.warning("service gateway accept failed: #{inspect(reason)}")
        accept_loop(socket, config)
    end
  end

  # A passive socket can be read before the acceptor hands ownership over.
  defp serve(client, config) do
    response =
      case :gen_tcp.recv(client, 0, @recv_timeout) do
        {:ok, body} ->
          case Jason.decode(body) do
            {:ok, request} -> Runtime.ServiceGateway.handle(request, config)
            {:error, _} -> %{"ok" => false, "code" => "bad_request", "error" => "request is not valid JSON"}
          end

        {:error, reason} ->
          {:closed, reason}
      end

    case response do
      {:closed, _} -> :ok
      map -> :gen_tcp.send(client, Jason.encode!(map))
    end

    :gen_tcp.close(client)
  end

  defp port_file(state_dir), do: Path.join(state_dir, "gateway_port")

  defp write_port_file(state_dir, port) do
    File.mkdir_p!(state_dir)
    File.write!(port_file(state_dir), Integer.to_string(port))
  end
end
