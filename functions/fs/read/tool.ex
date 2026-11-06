defmodule AgentFn.Fs.Read do
  @moduledoc """
  Read a text file from disk.

  Args:
  - `path` (required) — file to read
  - `max_bytes` — optional positive integer cap; when set and exceeded,
    content is truncated and `truncated` is true
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:max_bytes) => non_neg_integer(),
    required(:path) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    path = Map.get(args, "path") || Map.get(args, :path)
    max_bytes = Map.get(args, "max_bytes") || Map.get(args, :max_bytes)

    cond do
      not is_binary(path) or path == "" ->
        {:error, "path is required"}

      not File.regular?(path) ->
        {:error, "not a regular file: #{path}"}

      true ->
        case File.read(path) do
          {:ok, content} ->
            size = byte_size(content)

            {body, truncated} =
              case max_bytes do
                n when is_integer(n) and n >= 0 and size > n ->
                  {binary_part(content, 0, n), true}

                _ ->
                  {content, false}
              end

            {:ok,
             %{
               "path" => path,
               "content" => body,
               "size" => size,
               "truncated" => truncated,
               "max_bytes" => max_bytes
             }}

          {:error, reason} ->
            {:error, "failed to read #{path}: #{inspect(reason)}"}
        end
    end
  end
end