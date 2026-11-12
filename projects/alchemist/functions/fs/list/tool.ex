defmodule AgentFn.Fs.List do
  @moduledoc """
  List files and directories in a folder.

  Args: `path` (required string).

  Each entry includes `name`, `type`, `size` (bytes), `extension`,
  `create_time`, and `modify_time` (ISO-8601 UTC).

  On Unix, `create_time` is inode ctime (metadata change time), the closest
  value exposed by `File.stat/1`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    required(:path) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    path = Map.get(args, "path") || Map.get(args, :path)

    cond do
      not is_binary(path) or path == "" ->
        {:error, "path is required"}

      not File.dir?(path) ->
        {:error, "not a directory: #{path}"}

      true ->
        case File.ls(path) do
          {:ok, entries} ->
            files =
              entries
              |> Enum.sort()
              |> Enum.map(&entry_info(path, &1))

            {:ok, %{"path" => path, "count" => length(files), "entries" => files}}

          {:error, reason} ->
            {:error, "failed to list #{path}: #{inspect(reason)}"}
        end
    end
  end

  defp entry_info(dir, name) do
    full = Path.join(dir, name)
    ext = extension(name)

    base = %{
      "name" => name,
      "extension" => ext,
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
        type =
          cond do
            File.dir?(full) -> "dir"
            File.regular?(full) -> "file"
            true -> "other"
          end

        %{base | "type" => type}
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
    unix
    |> DateTime.from_unix!()
    |> DateTime.to_iso8601()
  end

  defp format_time(_), do: nil
end