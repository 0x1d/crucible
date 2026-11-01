defmodule Runtime.WarmLoadTest do
  use ExUnit.Case, async: false

  test "startup warm load compiles memory.remember and memory.transact" do
    assert function_exported?(AgentFn.Memory.Remember, :run, 1)
    assert function_exported?(AgentFn.Memory.Transact, :run, 1)

    remember_meta = Runtime.Codex.load_meta("memory.remember")
    transact_meta = Runtime.Codex.load_meta("memory.transact")
    assert remember_meta["loaded"] == true
    assert transact_meta["loaded"] == true
  end

  test "memory.remember succeeds on first call without load_function" do
    port = Runtime.Server.port()

    result =
      rpc(port, %{
        "op" => "call",
        "name" => "memory.remember",
        "args" => %{
          "reason" => "warm load test",
          "facts" => [
            %{
              "e" => "decision/warm-load-#{System.unique_integer([:positive])}",
              "a" => "description",
              "v" => "compiled at boot"
            }
          ]
        }
      })

    assert result["ok"] == true, inspect(result)
    assert result["function"] == "memory.remember"
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
end
