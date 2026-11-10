defmodule AgentFn.Services.GatewayTestGreeting do
  def run(%{"name" => "crash"}), do: raise("boom")
  def run(%{"name" => "slow"}), do: Process.sleep(1_000) && {:ok, %{"message" => "late"}}
  def run(%{"name" => "hungry"}), do: {:ok, %{"message" => Enum.to_list(1..5_000_000) |> length() |> to_string()}}
  def run(%{"name" => "wrong"}), do: {:ok, %{"message" => 42}}
  def run(%{"name" => name}), do: {:ok, %{message: "Hello, #{name}!"}}
end

defmodule Runtime.ServiceGatewayTest do
  use ExUnit.Case, async: false

  alias Runtime.ServiceGateway
  alias Runtime.ServiceGateway.Registry

  @slug "gateway_test_greeting"
  @source "defmodule AgentFn.Services.GatewayTestGreeting do\nend\n"

  setup do
    root = Path.join(System.tmp_dir!(), "gateway-test-#{System.unique_integer([:positive])}")
    functions = Path.join(root, "functions")
    state = Path.join(root, "state")
    dir = Registry.dir(functions, @slug)
    File.mkdir_p!(dir)
    File.mkdir_p!(state)
    File.write!(Path.join(dir, "tool.ex"), @source)

    File.write!(
      Path.join(dir, "meta.json"),
      Jason.encode!(%{
        "name" => "services.#{@slug}",
        "service" => %{
          "input_schema" => %{
            "type" => "object",
            "required" => ["name"],
            "properties" => %{"name" => %{"type" => "string", "minLength" => 1}},
            "additionalProperties" => false
          },
          "output_schema" => %{
            "type" => "object",
            "required" => ["message"],
            "properties" => %{"message" => %{"type" => "string"}}
          }
        }
      })
    )

    suffix = System.unique_integer([:positive])

    opts = [
      name: :"gateway_sup_#{suffix}",
      tasks: :"gateway_tasks_#{suffix}",
      listener: :"gateway_listener_#{suffix}",
      port: 0,
      state_dir: state,
      functions_root: functions,
      manifest_path: Path.join(state, "services.json"),
      timeout_ms: 200,
      max_heap_words: 500_000
    ]

    start_supervised!({ServiceGateway, opts})
    on_exit(fn -> File.rm_rf!(root) end)

    {:ok, opts: opts, state: state, dir: dir, port: ServiceGateway.port(opts[:listener])}
  end

  defp publish(state, sha \\ Registry.sha256(@source)) do
    File.write!(
      Path.join(state, "services.json"),
      Jason.encode!(%{"services" => [%{"slug" => @slug, "source_sha256" => sha}]})
    )
  end

  defp request(port, payload) do
    {:ok, socket} = :gen_tcp.connect(~c"127.0.0.1", port, [:binary, packet: 4, active: false])
    :ok = :gen_tcp.send(socket, Jason.encode!(payload))
    {:ok, body} = :gen_tcp.recv(socket, 0, 5_000)
    :gen_tcp.close(socket)
    Jason.decode!(body)
  end

  defp call(port, args), do: request(port, %{"op" => "call", "name" => @slug, "args" => args})

  test "writes its port file", %{state: state, port: port} do
    assert File.read!(Path.join(state, "gateway_port")) == Integer.to_string(port)
  end

  test "calls a published service", %{state: state, port: port} do
    publish(state)
    assert %{"ok" => true, "result" => %{"message" => "Hello, Ada!"}} = call(port, %{"name" => "Ada"})
  end

  test "refuses ops other than call", %{port: port} do
    for op <- ["define", "load", "find"] do
      assert %{"ok" => false, "code" => "op_refused"} =
               request(port, %{"op" => op, "name" => "x", "source" => "defmodule X do end"})
    end
  end

  test "refuses unpublished slugs", %{port: port} do
    assert %{"ok" => false, "code" => "not_published"} = call(port, %{"name" => "Ada"})
  end

  test "refuses a changed source", %{state: state, dir: dir, port: port} do
    publish(state)
    File.write!(Path.join(dir, "tool.ex"), @source <> "# edited\n")
    assert %{"ok" => false, "code" => "source_changed"} = call(port, %{"name" => "Ada"})
  end

  test "refuses slugs outside services/", %{port: port} do
    for slug <- ["../codex/echo", "Codex.Echo", "a/b"] do
      assert %{"ok" => false, "code" => "bad_slug"} =
               request(port, %{"op" => "call", "name" => slug, "args" => %{}})
    end
  end

  test "validates input and output", %{state: state, port: port} do
    publish(state)
    assert %{"code" => "invalid_input"} = call(port, %{})
    assert %{"code" => "invalid_input"} = call(port, %{"name" => "Ada", "extra" => 1})
    assert %{"code" => "invalid_output"} = call(port, %{"name" => "wrong"})
  end

  test "bounds time, heap, and crashes", %{state: state, port: port} do
    publish(state)
    assert %{"code" => "timeout"} = call(port, %{"name" => "slow"})
    assert %{"code" => "heap_exceeded"} = call(port, %{"name" => "hungry"})
    assert %{"code" => "failed"} = call(port, %{"name" => "crash"})
  end
end
