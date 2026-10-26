defmodule Runtime.Compiler do
  @moduledoc false

  alias Runtime.Codex

  @spec compile_shared!(keyword()) :: :ok
  def compile_shared!(opts \\ []) do
    lib_root = Path.join(Codex.functions_root(), "lib")

    if File.dir?(lib_root) do
      lib_root
      |> source_files_recursive()
      |> compile_files(opts)
    end

    :ok
  end

  @spec compile_slug!(String.t(), keyword()) :: module()
  def compile_slug!(slug, opts \\ []) do
    compile_shared!(opts)

    dir = Codex.function_dir(slug)

    unless File.dir?(dir) do
      throw({:error, "function not found: #{slug}"})
    end

    files = source_files_recursive(dir)

    if files == [] do
      throw({:error, "no .ex sources in #{slug}"})
    end

    compiled = compile_files(files, opts)

    expected = Codex.module_name(slug)

    entry =
      Enum.find(compiled, expected, fn mod ->
        function_exported?(mod, :run, 1)
      end)

    validate_entry_module!(slug, expected, entry, compiled)
    entry
  end

  defp source_files_recursive(dir) do
    dir
    |> Path.join("**/*.ex")
    |> Path.wildcard()
    |> Enum.sort_by(fn path ->
      depth = path |> Path.dirname() |> String.split("/") |> length()
      tool? = if Path.basename(path) == "tool.ex", do: 1, else: 0
      {depth + tool?, path}
    end)
  end

  # require_file/2 compiles a path once per VM. reload unrequires first so
  # load/define pick up edits. purge_compiler_modules/0 drops the temporary
  # modules a long-running node would otherwise keep.
  defp compile_files(paths, opts) do
    paths = Enum.map(paths, &Path.expand/1)
    reload? = Keyword.get(opts, :reload, false)
    if reload?, do: Code.unrequire_files(paths)

    try do
      compile = fn ->
        paths
        |> Enum.flat_map(fn path ->
          case Code.require_file(path) do
            nil -> []
            modules -> Enum.map(modules, &elem(&1, 0))
          end
        end)
        |> Enum.uniq()
      end

      if reload?, do: allowing_redefinition(compile), else: compile.()
    after
      Code.purge_compiler_modules()
    end
  end

  defp allowing_redefinition(fun) do
    previous = Code.get_compiler_option(:ignore_module_conflict)
    Code.put_compiler_option(:ignore_module_conflict, true)

    try do
      fun.()
    after
      Code.put_compiler_option(:ignore_module_conflict, previous)
    end
  end

  defp validate_entry_module!(slug, expected, entry, compiled) do
    unless entry == expected do
      throw({
        :error,
        "slug #{slug} must expose #{inspect(expected)}.run/1; " <>
          "compiled modules: #{inspect(compiled)}"
      })
    end

    unless Code.ensure_loaded?(expected) and function_exported?(expected, :run, 1) do
      throw({:error, "#{inspect(expected)} must implement run/1"})
    end
  end
end
