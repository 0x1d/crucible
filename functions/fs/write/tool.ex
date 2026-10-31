defmodule AgentFn.Fs.Write do
  @moduledoc """
  Write or append text to a file.

  Args:
  - `path` (required)
  - `content` (required string)
  - `append` — when true, append instead of overwrite (default false)
  - `overwrite` — required true to replace an existing file when not appending

  Creates parent directories as needed.
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    path = Map.get(args, "path") || Map.get(args, :path)
    content = Map.get(args, "content") || Map.get(args, :content)
    append? = truthy?(Map.get(args, "append") || Map.get(args, :append))
    overwrite? = truthy?(Map.get(args, "overwrite") || Map.get(args, :overwrite))

    cond do
      not is_binary(path) or path == "" ->
        {:error, "path is required"}

      not is_binary(content) ->
        {:error, "content must be a string"}

      File.exists?(path) and not append? and not overwrite? ->
        {:error, "file exists; pass overwrite=true or append=true: #{path}"}

      true ->
        dir = Path.dirname(path)

        with :ok <- File.mkdir_p(dir),
             :ok <- do_write(path, content, append?) do
          {:ok,
           %{
             "path" => path,
             "bytes_written" => byte_size(content),
             "append" => append?,
             "overwrite" => overwrite? and not append?
           }}
        else
          {:error, reason} ->
            {:error, "failed to write #{path}: #{inspect(reason)}"}
        end
    end
  end

  defp do_write(path, content, true), do: File.write(path, content, [:append])
  defp do_write(path, content, false), do: File.write(path, content)

  defp truthy?(v) when v in [true, "true", "1", 1, "yes"], do: true
  defp truthy?(_), do: false
end