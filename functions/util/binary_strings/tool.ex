defmodule AgentFn.Util.BinaryStrings do
  @moduledoc """
  Inspect a binary file (e.g. a MiniGraf `.graph` page file).

  Args:
  - `path` (required)
  - `min_len` — minimum printable run length (default 4)
  - `filter` — optional regex; only strings matching it are returned
  - `limit` — max strings returned (default 200)
  - `uuids` — optional list of UUID strings; reports byte offsets where each
    occurs as raw 16 bytes and as text
  - `needles` — optional list of strings; reports offsets for utf8,
    utf16le and utf16be encodings of each

  Returns `size`, `strings`, `string_count`, `uuid_hits`, `needle_hits`.
  """

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(%{"path" => path} = args) when is_binary(path) do
    with {:ok, bin} <- File.read(path) do
      min_len = Map.get(args, "min_len", 4)
      limit = Map.get(args, "limit", 200)

      re =
        case Map.get(args, "filter") do
          f when is_binary(f) and f != "" -> Regex.compile!(f)
          _ -> nil
        end

      strings =
        Regex.scan(~r/[\x20-\x7E]{#{min_len},}/, bin, return: :index)
        |> Enum.map(fn [{off, len}] -> {binary_part(bin, off, len), off} end)
        |> Enum.uniq_by(&elem(&1, 0))
        |> Enum.filter(fn {s, _} -> re == nil or Regex.match?(re, s) end)

      uuid_hits =
        args
        |> Map.get("uuids", [])
        |> Enum.map(fn u ->
          raw = u |> String.replace("-", "") |> Base.decode16!(case: :mixed)
          %{"uuid" => u, "raw_offsets" => offsets(bin, raw), "text_offsets" => offsets(bin, u)}
        end)

      needle_hits =
        args
        |> Map.get("needles", [])
        |> Enum.map(fn n ->
          %{
            "needle" => n,
            "utf8" => offsets(bin, n),
            "utf16le" => offsets(bin, :unicode.characters_to_binary(n, :utf8, {:utf16, :little})),
            "utf16be" => offsets(bin, :unicode.characters_to_binary(n, :utf8, {:utf16, :big}))
          }
        end)

      {:ok,
       %{
         "path" => path,
         "size" => byte_size(bin),
         "string_count" => length(strings),
         "strings" =>
           strings |> Enum.take(limit) |> Enum.map(fn {s, o} -> %{"s" => s, "offset" => o} end),
         "uuid_hits" => uuid_hits,
         "needle_hits" => needle_hits
       }}
    else
      {:error, r} -> {:error, "read failed: #{inspect(r)}"}
    end
  end

  def run(_), do: {:error, "path (string) is required"}

  defp offsets(_bin, ""), do: []
  defp offsets(bin, pat), do: :binary.matches(bin, pat) |> Enum.map(&elem(&1, 0))
end