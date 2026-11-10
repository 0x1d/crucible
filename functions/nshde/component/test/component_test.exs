defmodule AgentFn.Nshde.ComponentTest do
  use ExUnit.Case, async: false
  # A fake nshde API answers check and storage requests and reports each one.
  setup do
    previous = System.get_env("NSHDE_API_URL")
    on_exit(fn -> if previous, do: System.put_env("NSHDE_API_URL", previous), else: System.delete_env("NSHDE_API_URL") end)
    {:ok, ls} = :gen_tcp.listen(0, [:binary, active: false, packet: :http_bin, reuseaddr: true])
    {:ok, port} = :inet.port(ls)
    test = self()
    spawn_link(fn -> loop(ls, test) end)
    System.put_env("NSHDE_API_URL", "http://127.0.0.1:#{port}")
    :ok
  end
  defp loop(ls, test) do
    {:ok, s} = :gen_tcp.accept(ls)
    {:ok, {:http_request, method, {:abs_path, path}, _}} = :gen_tcp.recv(s, 0)
    len = headers(s, 0)
    :inet.setopts(s, packet: :raw)
    body = if len > 0, do: elem(:gen_tcp.recv(s, len), 1), else: ""
    send(test, {:req, method, path, body})
    resp = cond do
      path == "/api/modules/check" -> if String.contains?(body, "broken"), do: ~s({"ok":false,"errors":[{"message":"Unexpected token","line":2}]}), else: ~s({"ok":true,"errors":[],"capabilities":["service:greeting"]})
      String.starts_with?(path, "/api/storage?tree") -> ~s({"backend":"fs","tree":[{"kind":"directory","path":"components","children":[{"kind":"file","path":"components/b.nsh.tsx"},{"kind":"file","path":"components/a.nsh.tsx"}]}]})
      String.starts_with?(path, "/api/storage?path") -> ~s({"path":"components/a.nsh.tsx","content":"src"})
      true -> ~s({"ok":true})
    end
    :gen_tcp.send(s, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: #{byte_size(resp)}\r\nconnection: close\r\n\r\n" <> resp)
    :gen_tcp.close(s)
    loop(ls, test)
  end
  defp headers(s, len) do
    case :gen_tcp.recv(s, 0) do
      {:ok, {:http_header, _, :"Content-Length", _, v}} -> headers(s, String.to_integer(v))
      {:ok, {:http_header, _, _, _, _}} -> headers(s, len)
      {:ok, :http_eoh} -> len
    end
  end

  test "write checks then stores" do
    assert {:ok, %{"path" => "components/todo-list.nsh.tsx", "capabilities" => ["service:greeting"]}} =
      AgentFn.Nshde.Component.Write.run(%{"slug" => "todo-list", "source" => "export default () => null"})
    assert_received {:req, :POST, "/api/modules/check", _}
    assert_received {:req, :POST, "/api/storage", body}
    assert body =~ "components/todo-list.nsh.tsx"
  end
  test "write refuses broken source" do
    assert {:error, "component does not compile: line 2: Unexpected token"} =
      AgentFn.Nshde.Component.Write.run(%{"slug" => "x", "source" => "broken"})
    refute_received {:req, :POST, "/api/storage", _}
  end
  test "bad slugs" do
    assert {:error, _} = AgentFn.Nshde.Component.Write.run(%{"slug" => "../etc", "source" => "a"})
    assert {:error, _} = AgentFn.Nshde.Component.Read.run(%{"path" => "components/../x.nsh.tsx"})
  end
  test "read list check" do
    assert {:ok, %{"source" => "src"}} = AgentFn.Nshde.Component.Read.run(%{"slug" => "a"})
    assert {:ok, %{"paths" => ["components/a.nsh.tsx", "components/b.nsh.tsx"]}} = AgentFn.Nshde.Component.List.run(%{})
    assert {:ok, %{"ok" => true}} = AgentFn.Nshde.Component.Check.run(%{"source" => "x"})
  end
end
