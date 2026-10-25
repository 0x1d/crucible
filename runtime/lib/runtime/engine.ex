defmodule Runtime.Engine do
  @moduledoc false

  alias Runtime.Compiler
  alias Runtime.Registry

  def define(name, source, description) do
    {:ok, meta} = Registry.write_definition(name, source, description)

    try do
      slug = meta["name"]
      module = Compiler.compile_slug!(slug, reload: true)
      Registry.refresh_metadata!(slug, module)
      Registry.mark_loaded(slug, true)
      %{ok: true, function: Registry.load_meta(slug)}
    rescue
      e in ArgumentError -> %{ok: false, error: Exception.message(e)}
    catch
      :throw, {:error, message} -> %{ok: false, error: message}
    end
  end

  def load(name) do
    slug = Registry.sanitize(name)

    try do
      module = Compiler.compile_slug!(slug, reload: true)
      Registry.refresh_metadata!(slug, module)
      Registry.mark_loaded(slug, true)

      %{
        ok: true,
        function: Registry.load_meta(slug),
        module: Atom.to_string(module)
      }
    catch
      :throw, {:error, message} -> %{ok: false, error: message}
    end
  end

  def find(query) when is_binary(query) do
    q = String.downcase(String.trim(query))

    entries =
      Registry.list_all()
      |> Enum.filter(fn meta ->
        q == "" or
          String.contains?(String.downcase(meta["name"] || ""), q) or
          String.contains?(String.downcase(meta["description"] || ""), q) or
          String.contains?(String.downcase(meta["moduledoc"] || ""), q) or
          String.contains?(specs_blob(meta), q) or
          String.contains?(String.downcase(meta["module"] || ""), q)
      end)

    %{ok: true, functions: entries, count: length(entries)}
  end

  def call(name, args) when is_map(args) do
    slug = Registry.sanitize(name)
    module = Registry.module_name(slug)

    try do
      unless Code.ensure_loaded?(module) and function_exported?(module, :run, 1) do
        load(slug)
      end

      result =
        case apply(module, :run, [args]) do
          {:ok, value} -> %{ok: true, result: value}
          {:error, message} -> %{ok: false, error: to_string(message)}
          value when is_map(value) -> %{ok: true, result: value}
          other -> %{ok: true, result: other}
        end

      Map.put(result, :function, slug)
    rescue
      e in UndefinedFunctionError ->
        %{ok: false, error: "function #{slug} has no run/1: #{Exception.message(e)}"}

      e in ArgumentError ->
        %{ok: false, error: Exception.message(e)}
    catch
      :throw, {:error, message} ->
        %{ok: false, error: message}
    end
  end

  def call(_name, _args) do
    %{ok: false, error: "args must be a JSON object"}
  end

  defp specs_blob(meta) do
    (meta["specs"] || [])
    |> Enum.join(" ")
    |> String.downcase()
  end
end
