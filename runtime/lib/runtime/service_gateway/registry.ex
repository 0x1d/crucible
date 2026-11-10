defmodule Runtime.ServiceGateway.Registry do
  @moduledoc """
  Resolves a service slug to its codex entry and checks it against the manifest.

  A service named `weather` is the codex entry `services.weather` in
  `functions/services/weather/` with module `AgentFn.Services.Weather`.
  Dotted names map to nested directories (`geo.lookup` is
  `functions/services/geo/lookup/`).

  The manifest is a JSON file of published services:

      {"services": [{"slug": "weather", "source_sha256": "<hex>"}]}

  It is read on every call, so publishing takes effect at once.
  A slug is callable only when the manifest lists it and the SHA-256 of its
  current `tool.ex` equals the published `source_sha256`.
  """

  @slug ~r/\A[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\z/

  @type service :: %{
          slug: String.t(),
          module: module(),
          dir: String.t(),
          source_sha256: String.t(),
          input_schema: map() | boolean(),
          output_schema: map() | boolean()
        }

  @doc "Whether `slug` is a well-formed service name."
  @spec valid_slug?(term()) :: boolean()
  def valid_slug?(slug) when is_binary(slug), do: Regex.match?(@slug, slug)
  def valid_slug?(_), do: false

  @doc "Directory of the service entry under the functions root."
  @spec dir(String.t(), String.t()) :: String.t()
  def dir(functions_root, slug) do
    Path.join([functions_root, "services" | String.split(slug, ".")])
  end

  @doc "Module that implements the service (the codex module for `services.<slug>`)."
  @spec module(String.t()) :: module()
  def module(slug), do: Runtime.Codex.module_name("services." <> slug)

  @doc "Read the manifest as a map of slug to published source SHA-256."
  @spec read_manifest(String.t()) :: {:ok, %{String.t() => String.t()}} | {:error, String.t()}
  def read_manifest(path) do
    with {:ok, body} <- read_optional(path),
         {:ok, decoded} <- decode(body, "manifest") do
      entries = if is_map(decoded), do: Map.get(decoded, "services", []), else: []

      published =
        for %{"slug" => slug, "source_sha256" => sha} <- List.wrap(entries),
            is_binary(slug) and is_binary(sha),
            into: %{},
            do: {slug, String.downcase(sha)}

      {:ok, published}
    end
  end

  @doc """
  Resolve a published service.

  Error codes: `:bad_slug`, `:not_published`, `:not_found`, `:source_changed`,
  `:no_schema`, `:manifest`.
  """
  @spec resolve(String.t(), String.t(), String.t()) ::
          {:ok, service()} | {:error, atom(), String.t()}
  def resolve(slug, functions_root, manifest_path) do
    with {:slug, true} <- {:slug, valid_slug?(slug)},
         {:manifest, {:ok, manifest}} <- {:manifest, read_manifest(manifest_path)},
         {:published, {:ok, published}} <- {:published, Map.fetch(manifest, slug)},
         dir = dir(functions_root, slug),
         {:source, {:ok, source}} <- {:source, File.read(Path.join(dir, "tool.ex"))},
         sha = sha256(source),
         {:match, true} <- {:match, sha == published},
         {:meta, {:ok, meta}} <- {:meta, read_meta(dir)},
         {:schema, {:ok, input, output}} <- {:schema, schemas(meta)} do
      {:ok,
       %{
         slug: slug,
         module: module(slug),
         dir: dir,
         source_sha256: sha,
         input_schema: input,
         output_schema: output
       }}
    else
      {:slug, false} -> {:error, :bad_slug, "invalid service slug"}
      {:manifest, {:error, message}} -> {:error, :manifest, message}
      {:published, :error} -> {:error, :not_published, "service #{slug} is not published"}
      {:source, {:error, _}} -> {:error, :not_found, "service #{slug} has no source"}
      {:match, false} -> {:error, :source_changed, "service #{slug} changed since it was published"}
      {:meta, {:error, message}} -> {:error, :not_found, message}
      {:schema, {:error, message}} -> {:error, :no_schema, message}
    end
  end

  @doc "Lowercase hex SHA-256 of `data`."
  @spec sha256(iodata()) :: String.t()
  def sha256(data), do: :crypto.hash(:sha256, data) |> Base.encode16(case: :lower)

  defp read_meta(dir) do
    path = Path.join(dir, "meta.json")

    with {:ok, body} <- File.read(path) |> or_message("service has no meta.json"),
         {:ok, meta} when is_map(meta) <- decode(body, "meta.json") do
      {:ok, meta}
    else
      {:ok, _} -> {:error, "meta.json must be an object"}
      {:error, message} -> {:error, message}
    end
  end

  defp schemas(%{"service" => %{"input_schema" => input, "output_schema" => output}})
       when (is_map(input) or is_boolean(input)) and (is_map(output) or is_boolean(output)),
       do: {:ok, input, output}

  defp schemas(_meta),
    do: {:error, "meta.json needs service.input_schema and service.output_schema"}

  defp read_optional(path) do
    case File.read(path) do
      {:ok, body} -> {:ok, body}
      {:error, :enoent} -> {:ok, ~s({"services":[]})}
      {:error, reason} -> {:error, "cannot read manifest: #{:file.format_error(reason)}"}
    end
  end

  defp decode(body, label) do
    case Jason.decode(body) do
      {:ok, value} -> {:ok, value}
      {:error, _} -> {:error, "#{label} is not valid JSON"}
    end
  end

  defp or_message({:ok, value}, _message), do: {:ok, value}
  defp or_message({:error, _}, message), do: {:error, message}
end
