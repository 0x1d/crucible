defmodule AgentFn.Util.Uuid5Match do
  @moduledoc """
  Reverse-identify UUIDv5 values by brute-forcing candidate names.

  Args:
  - `candidates` (required) — list of name strings to hash
  - `targets` — list of UUID strings to identify (optional when `emit` is true)
  - `namespaces` — optional list of namespace UUID strings; defaults to the
    RFC 4122 namespaces (dns, url, oid, x500) plus the nil UUID
  - `variants` — when true (default), also tries each candidate with a
    leading `:` and stripped of a leading `:`
  - `emit` — when true, also return `computed`: every name/namespace/uuid

  Returns `matches`, `unmatched` targets, `tried`, and optionally `computed`.
  """

  @std_ns %{
    "dns" => "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "url" => "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    "oid" => "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
    "x500" => "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
    "nil" => "00000000-0000-0000-0000-000000000000"
  }
  @type args :: %{
    required(:namespaces) => [String.t()],
    required(:targets) => [String.t()]
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    emit = Map.get(args, "emit", false) == true

    with {:ok, cands} <- list_arg(args, "candidates"),
         {:ok, targets} <- targets_arg(args, emit) do
      ns =
        case Map.get(args, "namespaces") do
          l when is_list(l) and l != [] -> Enum.map(l, &{&1, &1})
          _ -> Enum.to_list(@std_ns)
        end

      names =
        if Map.get(args, "variants", true) do
          cands
          |> Enum.flat_map(fn c -> [c, ":" <> c, String.trim_leading(c, ":")] end)
          |> Enum.uniq()
        else
          cands
        end

      tset = MapSet.new(Enum.map(targets, &String.downcase/1))

      results =
        for {label, nsu} <- ns, name <- names do
          %{"uuid" => uuid5(nsu, name), "name" => name, "namespace" => label}
        end

      matches = Enum.filter(results, &MapSet.member?(tset, &1["uuid"]))
      found = MapSet.new(Enum.map(matches, & &1["uuid"]))

      base = %{
        "matches" => matches,
        "unmatched" => Enum.reject(targets, &MapSet.member?(found, String.downcase(&1))),
        "tried" => length(results)
      }

      {:ok, if(emit, do: Map.put(base, "computed", results), else: base)}
    end
  end

  def run(_), do: {:error, "args must be a map"}

  defp list_arg(args, k) do
    case Map.get(args, k) do
      l when is_list(l) and l != [] -> {:ok, Enum.map(l, &to_string/1)}
      _ -> {:error, "#{k} must be a non-empty list"}
    end
  end

  defp targets_arg(args, emit) do
    case Map.get(args, "targets") do
      l when is_list(l) -> {:ok, Enum.map(l, &to_string/1)}
      nil when emit -> {:ok, []}
      _ -> {:error, "targets must be a list (or set emit: true)"}
    end
  end

  defp uuid5(ns, name) do
    nsbin = ns |> String.replace("-", "") |> Base.decode16!(case: :mixed)
    <<a::binary-size(6), b6, b7, b8, rest::binary-size(7), _::binary>> =
      :crypto.hash(:sha, nsbin <> name)

    bin = <<a::binary, Bitwise.bor(Bitwise.band(b6, 0x0F), 0x50), b7,
            Bitwise.bor(Bitwise.band(b8, 0x3F), 0x80), rest::binary>>

    hex = Base.encode16(bin, case: :lower)

    Enum.join(
      [
        binary_part(hex, 0, 8),
        binary_part(hex, 8, 4),
        binary_part(hex, 12, 4),
        binary_part(hex, 16, 4),
        binary_part(hex, 20, 12)
      ],
      "-"
    )
  end
end