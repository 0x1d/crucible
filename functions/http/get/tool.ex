defmodule AgentFn.Http.Get do
  @moduledoc """
  Perform an HTTP GET request.

  Args:
  - `url` (required)
  - `headers` — optional map of header name => value
  - `timeout_ms` — default 15_000
  - `max_bytes` — optional response body cap (truncates when exceeded)
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:headers) => map(),
    optional(:max_bytes) => non_neg_integer(),
    optional(:timeout_ms) => non_neg_integer(),
    required(:url) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    url = Map.get(args, "url") || Map.get(args, :url)
    headers_in = Map.get(args, "headers") || Map.get(args, :headers) || %{}
    timeout = Map.get(args, "timeout_ms") || Map.get(args, :timeout_ms) || 15_000
    max_bytes = Map.get(args, "max_bytes") || Map.get(args, :max_bytes)

    cond do
      not is_binary(url) or url == "" ->
        {:error, "url is required"}

      not is_integer(timeout) or timeout <= 0 ->
        {:error, "timeout_ms must be a positive integer"}

      not is_map(headers_in) ->
        {:error, "headers must be a map"}

      true ->
        _ = Application.ensure_all_started(:inets)
        _ = Application.ensure_all_started(:ssl)

        headers =
          Enum.map(headers_in, fn {k, v} ->
            {String.to_charlist(to_string(k)), String.to_charlist(to_string(v))}
          end)

        http_opts = [timeout: timeout, connect_timeout: timeout]
        opts = [body_format: :binary]

        case :httpc.request(:get, {String.to_charlist(url), headers}, http_opts, opts) do
          {:ok, {{_http, status, _reason}, resp_headers, body}} when is_binary(body) ->
            size = byte_size(body)

            {body2, truncated} =
              case max_bytes do
                n when is_integer(n) and n >= 0 and size > n ->
                  {binary_part(body, 0, n), true}

                _ ->
                  {body, false}
              end

            header_map =
              Map.new(resp_headers, fn {k, v} ->
                {List.to_string(k), List.to_string(v)}
              end)

            {:ok,
             %{
               "url" => url,
               "status" => status,
               "headers" => header_map,
               "body" => body2,
               "size" => size,
               "truncated" => truncated
             }}

          {:ok, {{_http, status, reason}, resp_headers, body}} ->
            body_bin =
              cond do
                is_list(body) -> List.to_string(body)
                true -> inspect(body)
              end

            header_map =
              Map.new(resp_headers, fn {k, v} ->
                {List.to_string(k), List.to_string(v)}
              end)

            {:ok,
             %{
               "url" => url,
               "status" => status,
               "reason" => List.to_string(List.wrap(reason) |> List.flatten() |> then(fn _ -> to_string(reason) end)),
               "headers" => header_map,
               "body" => body_bin,
               "size" => byte_size(body_bin),
               "truncated" => false
             }}

          {:error, reason} ->
            {:error, "HTTP request failed: #{inspect(reason)}"}
        end
    end
  end
end