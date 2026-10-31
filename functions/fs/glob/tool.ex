defmodule AgentFn.Fs.Glob do
  @moduledoc """
  Glob filesystem paths under a root directory.

  Args:
  - `path` or `root` (required) — search root
  - `pattern` (required) — wildcard relative to root, e.g. `**/*.ex`

  Returns `entries` with the same shape as `fs.list`, plus `path` relative
  to the root on each entry.
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    root = Map.get(args, "path") || Map.get(args, :path) || Map.get(args, "root") || Map.get(args, :root)
    pattern = Map.get(args, "pattern") || Map.get(args, :pattern)

    cond do
      not is_binary(root) or root == "" ->
        {:error, "path (or root) is required"}

      not is_binary(pattern) or pattern == "" ->
        {:error, "pattern is required"}

      not File.dir?(root) ->
        {:error, "not a directory: #{root}"}

      true ->
        matches =
          root
          |> Path.join(pattern)
          |> Path.wildcard()
          |> Enum.sort()

        entries = Enum.map(matches, &entry_info(root, &1))

        {:ok,
         %{
           "root" => root,
           "pattern" => pattern,
           "count" => length(entries),
           "entries" => entries
         }}
    end
  end

  defp entry_info(root, full) do
    name = Path.basename(full)
    rel = Path.relative_to(full, root)

    base = %{
      "name" => name,
      "path" => rel,
      "extension" => extension(name),
      "type" => "other",
      "size" => nil,
      "create_time" => nil,
      "modify_time" => nil
    }

    case File.stat(full, time: :posix) do
      {:ok, %File.Stat{} = stat} ->
        type =
          case stat.type do
            :directory -> "dir"
            :regular -> "file"
            _ -> "other"
          end

        %{
          base
          | "type" => type,
            "size" => stat.size,
            "create_time" => format_time(stat.ctime),
            "modify_time" => format_time(stat.mtime)
        }

      {:error, _} ->
        base
    end
  end

  defp extension(name) do
    case Path.extname(name) do
      "" -> ""
      "." <> rest -> String.downcase(rest)
      other -> String.downcase(other)
    end
  end

  defp format_time(unix) when is_integer(unix) do
    unix |> DateTime.from_unix!() |> DateTime.to_iso8601()
  end

  defp format_time(_), do: nil
end