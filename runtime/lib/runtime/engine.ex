defmodule Runtime.Engine do
  @moduledoc """
  Orchestrates compile, metadata refresh, discovery search, and `run/1` invocation.

  Returns codex JSON result maps (`%{ok: true, ...}` or `%{ok: false, error: ...}`).
  """

  alias Runtime.Compiler
  alias Runtime.Codex

  def define(name, source, description) do
    {:ok, meta} = Codex.write_definition(name, source, description)
    slug = meta["name"]

    Runtime.Result.wrap(fn ->
      module = Compiler.compile_slug!(slug, reload: true)
      Codex.refresh_metadata!(slug, module)
      Codex.mark_loaded(slug, true)
      %{ok: true, function: Codex.load_meta(slug)}
    end)
  end

  def load(name) do
    slug = Codex.sanitize(name)

    Runtime.Result.wrap(fn ->
      module = Compiler.compile_slug!(slug, reload: true)
      Codex.refresh_metadata!(slug, module)
      Codex.mark_loaded(slug, true)

      %{
        ok: true,
        function: Codex.load_meta(slug),
        module: Atom.to_string(module)
      }
    end)
  end

  def find(query) when is_binary(query) do
    q = String.downcase(String.trim(query))

    entries =
      Codex.list_all()
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
    slug = Codex.sanitize(name)

    case ensure_ready(slug) do
      {:ok, module} -> invoke(module, slug, args)
      {:error, message} -> %{ok: false, error: message}
    end
  end

  def call(_name, _args) do
    %{ok: false, error: "args must be a JSON object"}
  end

  # Compiles only when the entry is not already loaded. The caller, which is
  # the connection task for a socket request, runs run/1.
  defp ensure_ready(slug) do
    module = Codex.module_name(slug)

    cond do
      ready?(module) ->
        {:ok, module}

      Process.whereis(Runtime.Server) ->
        Runtime.Server.serialize(fn -> load_ready(slug) end)

      true ->
        load_ready(slug)
    end
  end

  defp load_ready(slug) do
    module = Codex.module_name(slug)

    if ready?(module) do
      {:ok, module}
    else
      case load(slug) do
        %{ok: true} ->
          loaded = Codex.module_name(slug)
          if ready?(loaded), do: {:ok, loaded}, else: {:error, "function #{slug} has no run/1"}

        %{ok: false, error: message} ->
          {:error, message}
      end
    end
  end

  defp ready?(module) do
    Code.ensure_loaded?(module) and function_exported?(module, :run, 1)
  end

  defp invoke(module, slug, args) do
    result =
      try do
        case apply(module, :run, [args]) do
          {:ok, value} -> %{ok: true, result: value}
          {:error, message} -> %{ok: false, error: to_string(message)}
          value when is_map(value) -> %{ok: true, result: value}
          other -> %{ok: true, result: other}
        end
      rescue
        e in UndefinedFunctionError ->
          %{ok: false, error: "function #{slug} has no run/1: #{Exception.message(e)}"}

        e in ArgumentError ->
          %{ok: false, error: Exception.message(e)}

        exception ->
          %{ok: false, error: Exception.message(exception)}
      catch
        :throw, {:error, message} ->
          %{ok: false, error: message}

        :exit, reason ->
          %{ok: false, error: "exit: #{inspect(reason)}"}
      end

    Map.put(result, :function, slug)
  end

  defp specs_blob(meta) do
    (meta["specs"] || [])
    |> Enum.join(" ")
    |> String.downcase()
  end
end
