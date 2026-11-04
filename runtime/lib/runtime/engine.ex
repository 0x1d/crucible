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
      case compile_and_mark!(slug, reload: true) do
        module ->
          %{
            ok: true,
            function: Codex.load_meta(slug),
            module: Atom.to_string(module)
          }
      end
    end)
  end

  @doc """
  Compiles every discovered codex slug once (no reload).

  Runs on the compile serializer during application startup.
  """
  def warm_load_all! do
    Runtime.Server.serialize(fn ->
      {:ok, diagnostics} =
        Code.with_diagnostics(fn ->
          Codex.list_all()
          |> Enum.each(fn meta ->
            slug = meta["name"]
            warm_load_slug(slug)
          end)

          :ok
        end)

      diagnostics
      |> Enum.reject(&resolved_forward_reference?/1)
      |> Enum.each(&Code.print_diagnostic/1)

      :ok
    end)
  end

  # Entries compile one slug at a time in slug order, so a call into an entry
  # that sorts later (codex.docs -> md.table) is reported as undefined even
  # though it resolves once warm load finishes. Drop only those; a reference
  # that is still missing after every entry loaded is a real problem and stays.
  defp resolved_forward_reference?(%{severity: :warning, message: message}) do
    undefined_remote = ~r/^([A-Z][\w.]*)\.([a-z_]\w*[!?]?)\/(\d+) is undefined \(module /

    case Regex.run(undefined_remote, message) do
      [_, mod, fun, arity] ->
        module = Module.concat([mod])
        arity = String.to_integer(arity)

        Code.ensure_loaded?(module) and
          Enum.any?(module.__info__(:functions), fn {name, a} ->
            a == arity and Atom.to_string(name) == fun
          end)

      _ ->
        false
    end
  end

  defp resolved_forward_reference?(_), do: false

  def find(query, opts \\ %{}) when is_binary(query) and is_map(opts) do
    trimmed = String.trim(query)

    cond do
      trimmed == "" ->
        %{
          ok: false,
          error: "query is required; pass a substring or call_function on codex.docs"
        }

      find_detail?(opts) ->
        find_describe(trimmed)

      true ->
        find_search(String.downcase(trimmed), opts)
    end
  end

  defp find_describe(query) do
    slug =
      try do
        Codex.sanitize(query)
      rescue
        ArgumentError -> nil
      end

    cond do
      is_nil(slug) ->
        %{ok: false, error: "detail requires an exact codex slug (e.g. fs.read), not a search string"}

      true ->
        case Enum.find(Codex.list_all(), &(&1["name"] == slug)) do
          nil ->
            %{ok: false, error: "no entry named #{slug}"}

          meta ->
            %{
              ok: true,
              detail: true,
              name: slug,
              function: meta,
              functions: [meta],
              count: 1,
              truncated: false,
              limit: 1
            }
        end
    end
  end

  defp find_search(q, opts) do
    limit = find_limit(opts)

    matched =
      Codex.list_all()
      |> Enum.filter(fn meta ->
        String.contains?(String.downcase(meta["name"] || ""), q) or
          String.contains?(String.downcase(meta["description"] || ""), q) or
          String.contains?(String.downcase(meta["moduledoc"] || ""), q) or
          String.contains?(specs_blob(meta), q) or
          String.contains?(String.downcase(meta["module"] || ""), q)
      end)

    truncated = length(matched) > limit
    kept = Enum.take(matched, limit)
    functions = Enum.map(kept, &summarize_find/1)

    %{
      ok: true,
      functions: functions,
      count: length(functions),
      truncated: truncated,
      detail: false,
      limit: limit
    }
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
      case compile_and_mark_result(slug, reload: true) do
        {:ok, loaded} ->
          if ready?(loaded), do: {:ok, loaded}, else: {:error, "function #{slug} has no run/1"}

        {:error, message} ->
          {:error, message}
      end
    end
  end

  defp warm_load_slug(slug) do
    module = Codex.module_name(slug)

    if ready?(module) do
      Codex.mark_loaded(slug, true)
    else
      case compile_and_mark_result(slug, reload: false) do
        {:ok, _module} ->
          :ok

        {:error, message} ->
          require Logger

          Logger.warning(
            "[runtime] codex warm load skipped #{slug}: #{message}"
          )
      end
    end
  end

  defp compile_and_mark!(slug, opts) do
    module = Compiler.compile_slug!(slug, opts)
    Codex.refresh_metadata!(slug, module)
    Codex.mark_loaded(slug, true)
    module
  end

  defp compile_and_mark_result(slug, opts) do
    case Runtime.Result.wrap(fn -> compile_and_mark!(slug, opts) end) do
      %{ok: false, error: message} -> {:error, message}
      module when is_atom(module) -> {:ok, module}
      other -> {:error, "unexpected compile result: #{inspect(other)}"}
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

  @default_find_limit 12
  @max_find_limit 40

  defp find_limit(opts) do
    case Map.get(opts, "limit") do
      n when is_integer(n) and n >= 1 and n <= @max_find_limit ->
        n

      n when is_binary(n) ->
        case Integer.parse(n) do
          {parsed, ""} when parsed >= 1 and parsed <= @max_find_limit -> parsed
          _ -> @default_find_limit
        end

      _ ->
        @default_find_limit
    end
  end

  defp find_detail?(opts) do
    Map.get(opts, "detail") in [true, "true", 1, "1"]
  end

  defp summarize_find(meta) do
    %{
      "name" => meta["name"],
      "summary" => summary_line(meta),
      "loaded" => Map.get(meta, "loaded")
    }
  end

  defp summary_line(meta) do
    (meta["moduledoc"] || meta["description"] || "")
    |> to_string()
    |> String.split("\n", parts: 2)
    |> hd()
    |> String.trim()
    |> String.slice(0, 160)
  end
end
