defmodule AgentLib.Nshde do
  @moduledoc """
  Client for the nshde HTTP API, shared by the `nshde.component.*` entries.
  Not callable via `call_function`.

  The base URL is `NSHDE_API_URL` (default `http://127.0.0.1:43123`).
  """

  @default_base "http://127.0.0.1:43123"
  @component_slug ~r/\A[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\z/

  @doc "Send one request and decode the JSON response."
  @spec request(String.t(), String.t(), map() | nil) :: {:ok, map()} | {:error, String.t()}
  def request(method, path, body \\ nil) do
    url = String.to_charlist(base_url() <> path)
    _ = Application.ensure_all_started(:inets)
    _ = Application.ensure_all_started(:ssl)

    request =
      case {method, body} do
        {"POST", body} -> {url, [], ~c"application/json", Jason.encode!(body || %{})}
        _ -> {url, []}
      end

    verb =
      case method do
        "POST" -> :post
        "DELETE" -> :delete
        _ -> :get
      end

    case :httpc.request(verb, request, [timeout: 30_000, connect_timeout: 5_000], body_format: :binary) do
      {:ok, {{_, status, _}, _headers, response}} -> decode(status, response)
      {:error, reason} -> {:error, "nshde API unreachable at #{base_url()}: #{inspect(reason)}"}
    end
  end

  @doc "nshde API base URL without a trailing slash."
  @spec base_url() :: String.t()
  def base_url do
    case System.get_env("NSHDE_API_URL") do
      nil -> @default_base
      "" -> @default_base
      url -> String.trim_trailing(url, "/")
    end
  end

  @doc """
  Resolve a component's storage path from `slug` (`todo-list` →
  `components/todo-list.nsh.tsx`) or `path` (must be under `components/`
  and end in `.nsh.tsx`).
  """
  @spec component_path(map()) :: {:ok, String.t()} | {:error, String.t()}
  def component_path(args) do
    case {get(args, "slug"), get(args, "path")} do
      {slug, _} when is_binary(slug) ->
        if Regex.match?(@component_slug, slug),
          do: {:ok, "components/#{slug}.nsh.tsx"},
          else: {:error, "slug must be lowercase kebab-case, such as todo-list"}

      {_, path} when is_binary(path) ->
        if String.starts_with?(path, "components/") and String.ends_with?(path, ".nsh.tsx") and
             not String.contains?(path, ".."),
           do: {:ok, path},
           else: {:error, "path must be components/<slug>.nsh.tsx"}

      _ ->
        {:error, "slug or path is required"}
    end
  end

  @doc "Read a string or atom key."
  def get(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, String.to_atom(key))

  defp decode(status, body) do
    parsed =
      case Jason.decode(body) do
        {:ok, value} when is_map(value) -> value
        _ -> %{"error" => String.slice(body, 0, 500)}
      end

    if status in 200..299,
      do: {:ok, parsed},
      else: {:error, "nshde API #{status}: #{parsed["error"] || inspect(parsed)}"}
  end
end
