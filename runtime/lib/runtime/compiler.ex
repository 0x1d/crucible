defmodule Runtime.Compiler do
  @moduledoc false

  alias Runtime.Registry

  @spec compile_shared!() :: :ok
  def compile_shared! do
    lib_root = Path.join(Registry.functions_root(), "lib")

    if File.dir?(lib_root) do
      lib_root
      |> source_files_recursive()
      |> compile_files()
    end

    :ok
  end

  @spec compile_slug!(String.t()) :: module()
  def compile_slug!(slug) do
    compile_shared!()

    dir = Registry.function_dir(slug)

    unless File.dir?(dir) do
      throw({:error, "function not found: #{slug}"})
    end

    files = source_files_recursive(dir)

    if files == [] do
      throw({:error, "no .ex sources in #{slug}"})
    end

    compiled = compile_files(files)

    expected = Registry.module_name(slug)

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

  defp compile_files(paths) do
    paths
    |> Enum.flat_map(fn path ->
      Code.compile_file(path)
      |> List.wrap()
      |> Enum.map(fn {mod, _} -> mod end)
    end)
    |> Enum.uniq()
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
