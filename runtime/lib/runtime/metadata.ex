defmodule Runtime.Metadata do
  @moduledoc """
  Extracts `@moduledoc`, `@type args`, and `@spec run/1` for `meta.json` refresh after compile.
  """

  alias Runtime.Codex

  @spec extract(module(), String.t()) :: map()
  def extract(module, slug) when is_atom(module) and is_binary(slug) do
    path = Codex.source_path(slug)
    source = if File.exists?(path), do: File.read!(path), else: ""

    %{
      "moduledoc" => fetch_moduledoc(module, source),
      "specs" => fetch_specs(source)
    }
  end

  defp fetch_moduledoc(module, source) do
    from_docs =
      case Code.fetch_docs(module) do
        {:docs_v1, _, :elixir, _, doc, _, _} when is_binary(doc) -> String.trim(doc)
        _ -> nil
      end

    from_docs || moduledoc_from_source(source)
  end

  defp moduledoc_from_source(source) do
    case Regex.run(~r/@moduledoc\s+"""\s*(.*?)\s*"""/s, source) do
      [_, doc] ->
        String.trim(doc)

      _ ->
        case Regex.run(~r/@moduledoc\s+"([^"]*)"/, source) do
          [_, doc] -> String.trim(doc)
          _ -> nil
        end
    end
  end

  defp fetch_specs(source) do
    [extract_type_args(source), extract_run_spec(source)]
    |> Enum.reject(&is_nil/1)
  end

  defp extract_type_args(source) do
    case :binary.match(source, "@type args ::") do
      {start, _} ->
        fragment = binary_part(source, start, byte_size(source) - start)

        case Regex.run(~r/^@type args\s::\s*/u, fragment) do
          [prefix | _] ->
            rest = String.replace_prefix(fragment, prefix, "")
            body = take_map_type(rest)
            "@type args :: #{body}"

          _ ->
            nil
        end

      :nomatch ->
        nil
    end
  end

  defp extract_run_spec(source) do
    case Regex.run(~r/^\s*@spec\s+run\([^\n]+\)\s*::\s*.+$/m, source) do
      [line] -> String.trim(line)
      _ -> nil
    end
  end

  defp take_map_type(text) do
    trimmed = String.trim_leading(text)

    cond do
      String.starts_with?(trimmed, "%{") ->
        case brace_end(trimmed, 0, 0) do
          {:ok, end_at} -> String.trim(binary_part(trimmed, 0, end_at + 1))
          :error -> trimmed
        end

      true ->
        trimmed
        |> String.split("\n", parts: 2)
        |> hd()
        |> String.trim()
    end
  end

  defp brace_end(<<"{", rest::binary>>, idx, depth),
    do: brace_end(rest, idx + 1, depth + 1)

  defp brace_end(<<"}", _rest::binary>>, idx, 1), do: {:ok, idx}

  defp brace_end(<<"}", rest::binary>>, idx, depth),
    do: brace_end(rest, idx + 1, depth - 1)

  defp brace_end(<<_, rest::binary>>, idx, depth), do: brace_end(rest, idx + 1, depth)
  defp brace_end(<<>>, _idx, _depth), do: :error
end
