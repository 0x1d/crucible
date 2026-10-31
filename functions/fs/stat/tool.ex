defmodule AgentFn.Fs.Stat do
  @moduledoc """
  Stat a single filesystem path.

  Args: `path` (required string).

  Returns `name`, `path`, `type` (`file`/`dir`/`symlink`/`other`), `size`,
  `extension`, `mode` (octal string), `create_time`, `modify_time`, and
  `symlink_target` when the path is a symlink.
  """
  @behaviour AgentFn.Tool

  import Bitwise

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    path = Map.get(args, "path") || Map.get(args, :path)

    cond do
      not is_binary(path) or path == "" ->
        {:error, "path is required"}

      true ->
        case File.lstat(path, time: :posix) do
          {:ok, %File.Stat{} = stat} ->
            type =
              case stat.type do
                :directory -> "dir"
                :regular -> "file"
                :symlink -> "symlink"
                _ -> "other"
              end

            target =
              if type == "symlink" do
                case File.read_link(path) do
                  {:ok, t} -> t
                  _ -> nil
                end
              else
                nil
              end

            {:ok,
             %{
               "path" => path,
               "name" => Path.basename(path),
               "type" => type,
               "size" => stat.size,
               "extension" => extension(Path.basename(path)),
               "mode" => Integer.to_string(stat.mode &&& 0o777, 8),
               "create_time" => format_time(stat.ctime),
               "modify_time" => format_time(stat.mtime),
               "symlink_target" => target
             }}

          {:error, reason} ->
            {:error, "failed to stat #{path}: #{inspect(reason)}"}
        end
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