defmodule AgentFn.Fs.Tree do
  @moduledoc """
  Build a bounded-depth directory tree.

  Args:
  - `path` (required)
  - `max_depth` — default 3 (0 = only the root node)
  - `ignore` — optional list of basename glob patterns to skip (e.g. `".git"`, `"node_modules"`)

  Returns a nested `tree` map with `name`, `type`, `children`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:ignore) => [String.t()],
    optional(:max_depth) => non_neg_integer(),
    required(:path) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    path = Map.get(args, "path") || Map.get(args, :path)
    max_depth = Map.get(args, "max_depth") || Map.get(args, :max_depth) || 3
    ignore = Map.get(args, "ignore") || Map.get(args, :ignore) || []

    cond do
      not is_binary(path) or path == "" ->
        {:error, "path is required"}

      not is_integer(max_depth) or max_depth < 0 ->
        {:error, "max_depth must be a non-negative integer"}

      not File.dir?(path) ->
        {:error, "not a directory: #{path}"}

      true ->
        ignore_list = List.wrap(ignore) |> Enum.map(&to_string/1)
        tree = walk(path, max_depth, ignore_list)

        {:ok,
         %{
           "path" => path,
           "max_depth" => max_depth,
           "ignore" => ignore_list,
           "tree" => tree
         }}
    end
  end

  defp walk(path, depth, ignore) do
    name = Path.basename(path)

    node = %{
      "name" => name,
      "type" => "dir",
      "children" => []
    }

    if depth <= 0 do
      node
    else
      children =
        case File.ls(path) do
          {:ok, names} ->
            names
            |> Enum.sort()
            |> Enum.reject(&ignored?(&1, ignore))
            |> Enum.map(fn name ->
              full = Path.join(path, name)

              cond do
                File.dir?(full) ->
                  walk(full, depth - 1, ignore)

                true ->
                  %{
                    "name" => name,
                    "type" => if(File.regular?(full), do: "file", else: "other")
                  }
              end
            end)

          {:error, _} ->
            []
        end

      %{node | "children" => children}
    end
  end

  defp ignored?(name, patterns) do
    Enum.any?(patterns, fn pat ->
      case Path.wildcard(pat, match_dot: true) do
        _ ->
          # Path.wildcard needs a path; use simple glob match via :filelib
          match_glob?(name, pat)
      end
    end)
  end

  defp match_glob?(name, pattern) do
    regex =
      pattern
      |> Regex.escape()
      |> String.replace("\\*", ".*")
      |> String.replace("\\?", ".")
      |> then(&("^" <> &1 <> "$"))
      |> Regex.compile!()

    Regex.match?(regex, name)
  end
end