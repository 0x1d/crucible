defmodule Runtime.ServerTest do
  use ExUnit.Case, async: false

  test "application supervises a long-lived codex server" do
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

  test "application supervises a task supervisor and a permanent acceptor" do
    [memory, tasks, server, warmup, acceptor] = Runtime.Application.children()

    assert memory == Runtime.Memory
    assert tasks == {Task.Supervisor, name: Runtime.TaskSupervisor}
    assert server == Runtime.Server
    assert warmup == Runtime.CodexWarmup
    assert acceptor.id == Runtime.Acceptor
    assert acceptor.restart == :permanent
    assert elem(acceptor.start, 0) == Task

    ids =
      Runtime.Supervisor
      |> Supervisor.which_children()
      |> Enum.map(&elem(&1, 0))
      |> MapSet.new()

    assert ids ==
             MapSet.new([
               Runtime.Memory,
               Runtime.TaskSupervisor,
               Runtime.Server,
               Runtime.CodexWarmup,
               Runtime.Acceptor
             ])

    server = Process.whereis(Runtime.Server)
    acceptor = Runtime.Server.acceptor()
    assert is_pid(server)
    assert is_pid(acceptor)
    refute acceptor == server
    assert Process.alive?(acceptor)
    assert Process.info(server, :trap_exit) == {:trap_exit, false}
    assert Process.info(acceptor, :trap_exit) == {:trap_exit, false}
    assert listen_owner(Runtime.Server.port()) == acceptor
  end

  test "accept loop exits when accept fails" do
    {:ok, listen} =
      :gen_tcp.listen(0, [:binary, packet: 4, active: false, ip: {127, 0, 0, 1}])

    {:ok, port} = :inet.port(listen)

    {:ok, client} =
      :gen_tcp.connect({127, 0, 0, 1}, port, [:binary, packet: 4, active: false], 1_000)

    pid = spawn(fn -> Runtime.Server.accept_loop(client) end)
    ref = Process.monitor(pid)

    on_exit(fn ->
      Process.exit(pid, :kill)
      :gen_tcp.close(client)
      :gen_tcp.close(listen)
    end)

    assert_receive {:DOWN, ^ref, :process, ^pid, reason}, 500
    refute match?({:undef, _}, reason)
  end

  test "connection tasks own the socket and run user code" do
    root = tmp_root("socket-owner")

    with_functions_root(root, fn ->
      Process.register(self(), :socket_owner_waiter)

      try do
        connection_owns_socket()
      after
        unregister(:socket_owner_waiter)
      end
    end)
  end

  defp connection_owns_socket do
    defined =
      rpc(Runtime.Server.port(), %{
        "op" => "define",
        "name" => "socket_owner",
        "source" => """
        def run(_args) do
          send(:socket_owner_waiter, {:in_run, self()})

          receive do
            :go -> {:ok, %{ran: true}}
          after
            5_000 -> {:error, "timed out"}
          end
        end
        """
      })

    assert defined["ok"] == true, inspect(defined)

    caller =
      Task.async(fn ->
        rpc(Runtime.Server.port(), %{"op" => "call", "name" => "socket_owner", "args" => %{}})
      end)

    assert_receive {:in_run, runner}, 5_000
    assert runner in Task.Supervisor.children(Runtime.TaskSupervisor)
    refute runner == Process.whereis(Runtime.Server)
    refute runner == Runtime.Server.acceptor()
    assert client_owner(Runtime.Server.port()) == runner

    send(runner, :go)
    assert Task.await(caller, 5_000)["ok"] == true
    assert Task.Supervisor.children(Runtime.TaskSupervisor) == []
  end

  test "two clients are served at the same time" do
    root = tmp_root("concurrent")

    with_functions_root(root, fn ->
      Process.register(self(), :concurrent_waiter)

      try do
        two_clients_at_once()
      after
        unregister(:concurrent_waiter)
      end
    end)
  end

  defp two_clients_at_once do
    defined =
      rpc(Runtime.Server.port(), %{
        "op" => "define",
        "name" => "concurrent_hold",
        "source" => """
        def run(args) do
          send(:concurrent_waiter, {:in_run, args["n"], self()})

          receive do
            :go -> {:ok, %{"n" => args["n"]}}
          after
            5_000 -> {:error, "timed out"}
          end
        end
        """
      })

    assert defined["ok"] == true, inspect(defined)
    port = Runtime.Server.port()

    callers =
      Enum.map([1, 2], fn n ->
        Task.async(fn ->
          rpc(port, %{"op" => "call", "name" => "concurrent_hold", "args" => %{"n" => n}})
        end)
      end)

    assert_receive {:in_run, 1, first}, 5_000
    assert_receive {:in_run, 2, second}, 5_000
    assert first != second

    assert MapSet.new(Task.Supervisor.children(Runtime.TaskSupervisor)) ==
             MapSet.new([first, second])

    send(first, :go)
    send(second, :go)

    results = Enum.map(callers, &Task.await(&1, 5_000))
    assert Enum.map(results, & &1["result"]["n"]) |> Enum.sort() == [1, 2]
  end

  test "exit inside run/1 stays in the connection" do
    root = tmp_root("exit-run")

    with_functions_root(root, fn ->
      defined =
        rpc(Runtime.Server.port(), %{
          "op" => "define",
          "name" => "exit_run",
          "source" => """
          def run(_args), do: exit(:boom)
          """
        })

      assert defined["ok"] == true, inspect(defined)
      server = Process.whereis(Runtime.Server)
      acceptor = Runtime.Server.acceptor()
      port = Runtime.Server.port()

      failed = rpc(port, %{"op" => "call", "name" => "exit_run", "args" => %{}})
      assert failed["ok"] == false
      assert Process.whereis(Runtime.Server) == server
      assert Runtime.Server.acceptor() == acceptor
      assert Runtime.Server.port() == port

      again =
        rpc(port, %{
          "op" => "call",
          "name" => "exit_run",
          "args" => %{}
        })

      assert again["ok"] == false
      assert Process.whereis(Runtime.Server) == server
    end)
  end

  test "a linked worker exit does not take down the acceptor" do
    root = tmp_root("linked-worker")

    with_functions_root(root, fn ->
      defined =
        rpc(Runtime.Server.port(), %{
          "op" => "define",
          "name" => "linked_worker",
          "source" => """
          def run(_args) do
            spawn_link(fn -> exit(:worker_down) end)
            Process.sleep(2_000)
            {:ok, %{survived: true}}
          end
          """
        })

      assert defined["ok"] == true, inspect(defined)
      server = Process.whereis(Runtime.Server)
      acceptor = Runtime.Server.acceptor()

      failed =
        rpc(Runtime.Server.port(), %{
          "op" => "call",
          "name" => "linked_worker",
          "args" => %{}
        })

      refute get_in(failed, ["result", "survived"])
      assert Process.whereis(Runtime.Server) == server
      assert Runtime.Server.acceptor() == acceptor
      assert listen_owner(Runtime.Server.port()) == acceptor

      found = rpc(Runtime.Server.port(), %{"op" => "find", "query" => "linked_worker"})
      assert found["ok"] == true
    end)
  end

  test "the supervisor replaces a killed acceptor" do
    server = Process.whereis(Runtime.Server)
    first = Runtime.Server.acceptor()
    Process.exit(first, :kill)

    replacement = wait_for_acceptor(first)
    assert replacement != first
    assert Process.alive?(replacement)
    assert Process.whereis(Runtime.Server) == server
    assert listen_owner(Runtime.Server.port()) == replacement

    found = rpc(Runtime.Server.port(), %{"op" => "find", "query" => ""})
    assert found["ok"] == false
    assert found["error"] =~ "query is required"
  end

  defp rpc(port, payload) do
    {:ok, sock} =
      :gen_tcp.connect(~c"127.0.0.1", port, [:binary, packet: 4, active: false], 5_000)

    :ok = :gen_tcp.send(sock, Jason.encode!(payload))

    result =
      case :gen_tcp.recv(sock, 0, 15_000) do
        {:ok, body} -> Jason.decode!(body)
        {:error, reason} -> %{"ok" => false, "error" => "socket #{inspect(reason)}"}
      end

    :gen_tcp.close(sock)
    result
  end

  defp unregister(name) do
    if Process.whereis(name) == self(), do: Process.unregister(name)
  end

  defp tmp_root(name) do
    root =
      Path.join(System.tmp_dir!(), "alchemist-#{name}-#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    root
  end

  defp with_functions_root(root, fun) do
    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    try do
      fun.()
    after
      if previous do
        System.put_env("AGENT_FUNCTIONS_DIR", previous)
      else
        System.delete_env("AGENT_FUNCTIONS_DIR")
      end

      File.rm_rf!(root)
    end
  end

  defp wait_for_acceptor(previous) do
    Enum.reduce_while(1..100, nil, fn _, _ ->
      current = Runtime.Server.acceptor()
      port = port_if_published()

      if is_pid(current) and current != previous and Process.alive?(current) and
           listen_owner(port) == current do
        {:halt, current}
      else
        Process.sleep(20)
        {:cont, nil}
      end
    end)
  end

  defp port_if_published do
    :persistent_term.get({Runtime.Server, :port}, nil)
  end

  defp listen_owner(listen_port) do
    Enum.find_value(:erlang.ports(), fn port ->
      with {:ok, {{127, 0, 0, 1}, ^listen_port}} <- :inet.sockname(port),
           {:error, _} <- :inet.peername(port),
           {:connected, pid} <- Port.info(port, :connected) do
        pid
      else
        _ -> nil
      end
    end)
  end

  defp client_owner(listen_port) do
    Enum.find_value(:erlang.ports(), fn port ->
      with {:ok, {{127, 0, 0, 1}, ^listen_port}} <- :inet.sockname(port),
           {:ok, _} <- :inet.peername(port),
           {:connected, pid} <- Port.info(port, :connected) do
        pid
      else
        _ -> nil
      end
    end)
  end
end
