defmodule Runtime.ServerTest do
  use ExUnit.Case, async: false

  test "application supervises a long-lived registry server" do
    pid = Process.whereis(Runtime.Server)
    assert is_pid(pid)
    assert Process.alive?(pid)

    port = Runtime.Server.port()
    assert is_integer(port) and port > 0
    assert Runtime.Server.port() == port
  end

  test "two ops run inside the same VM and keep compiled modules loaded" do
    root =
      Path.join(System.tmp_dir!(), "alchemist-server-#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    on_exit(fn ->
      if previous do
        System.put_env("AGENT_FUNCTIONS_DIR", previous)
      else
        System.delete_env("AGENT_FUNCTIONS_DIR")
      end

      File.rm_rf!(root)
      :code.purge(AgentFn.ServerProbe)
      :code.delete(AgentFn.ServerProbe)
    end)

    :code.purge(AgentFn.ServerProbe)
    :code.delete(AgentFn.ServerProbe)
    refute function_exported?(AgentFn.ServerProbe, :run, 1)

    server = Process.whereis(Runtime.Server)
    port = Runtime.Server.port()

    defined =
      rpc(port, %{
        "op" => "define",
        "name" => "server_probe",
        "source" => """
        def run(args), do: {:ok, %{"probe" => args["n"]}}
        """
      })

    assert defined["ok"] == true, inspect(defined)
    assert function_exported?(AgentFn.ServerProbe, :run, 1)

    called =
      rpc(port, %{
        "op" => "call",
        "name" => "server_probe",
        "args" => %{"n" => 2}
      })

    assert called["ok"] == true
    assert called["result"]["probe"] == 2
    assert Process.whereis(Runtime.Server) == server
    assert Runtime.Server.port() == port
  end

  defp rpc(port, payload) do
    {:ok, sock} =
      :gen_tcp.connect(~c"127.0.0.1", port, [:binary, packet: 4, active: false], 5_000)

    :ok = :gen_tcp.send(sock, Jason.encode!(payload))
    {:ok, body} = :gen_tcp.recv(sock, 0, 15_000)
    :gen_tcp.close(sock)
    Jason.decode!(body)
  end
end
