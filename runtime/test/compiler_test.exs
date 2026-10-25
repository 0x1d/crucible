defmodule Runtime.CompilerTest do
  use ExUnit.Case, async: false

  test "a slug is compiled once per VM" do
    with_root(fn root ->
      write_probe(root, "a")
      Runtime.Compiler.compile_slug!("compile_probe")
      stamp = probe_stamp()

      Runtime.Compiler.compile_slug!("compile_probe")

      assert probe_stamp() == stamp
      assert probe_run(%{"n" => 1}) == {:ok, %{"n" => 1, "body" => "a"}}
    end)
  end

  test "load recompiles a changed source and drops compiler modules" do
    with_root(fn root ->
      write_probe(root, "a")
      assert %{ok: true} = Runtime.Engine.load("compile_probe")
      stamp = probe_stamp()
      baseline = compiler_module_count()

      for i <- 1..6 do
        write_probe(root, "v#{i}")
        assert %{ok: true} = Runtime.Engine.load("compile_probe")
      end

      assert probe_stamp() != stamp
      assert probe_run(%{"n" => 1}) == {:ok, %{"n" => 1, "body" => "v6"}}
      assert compiler_module_count() <= baseline + 1
    end)
  end

  defp with_root(fun) do
    root =
      Path.join(System.tmp_dir!(), "alchemist-compiler-#{System.unique_integer([:positive])}")

    File.mkdir_p!(root)
    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    try do
      fun.(root)
    after
      if previous do
        System.put_env("AGENT_FUNCTIONS_DIR", previous)
      else
        System.delete_env("AGENT_FUNCTIONS_DIR")
      end

      File.rm_rf(root)
      :code.purge(AgentFn.CompileProbe)
      :code.delete(AgentFn.CompileProbe)
    end
  end

  defp write_probe(root, body) do
    dir = Path.join(root, "compile_probe")
    File.mkdir_p!(dir)

    File.write!(Path.join(dir, "tool.ex"), """
    defmodule AgentFn.CompileProbe do
      @behaviour AgentFn.Tool
      @stamp System.unique_integer([:positive])
      def stamp, do: @stamp
      def run(args), do: {:ok, %{"n" => args["n"], "body" => #{inspect(body)}}}
    end
    """)
  end

  defp probe_stamp, do: apply(AgentFn.CompileProbe, :stamp, [])

  defp probe_run(args), do: apply(AgentFn.CompileProbe, :run, [args])

  defp compiler_module_count do
    :code.all_loaded()
    |> Enum.count(fn {mod, _} ->
      mod |> Atom.to_string() |> String.starts_with?("elixir_compiler_")
    end)
  end
end
