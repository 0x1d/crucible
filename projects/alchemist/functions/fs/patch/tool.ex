defmodule AgentFn.Fs.Patch do
  @moduledoc """
  Apply exact search/replace edits to an arbitrary text file.

  Args:
  - `path` (required) — file to edit
  - `edits` (required) — list of `%{"old" => string, "new" => string}`;
    optional per-edit `"replace_all" => true`
  - `dry_run` — validate and report without writing (default false)

  Each `old` must match exactly once in the current text (unless
  `replace_all`), otherwise nothing is written. Edits apply in order.
  Returns `path`, `applied` (per-edit match counts), `written`.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:dry_run) => boolean(),
    required(:edits) => [map()],
    required(:path) => String.t()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    path = args["path"]
    edits = args["edits"]
    dry = args["dry_run"] == true

    cond do
      not is_binary(path) -> {:error, "path is required"}
      not is_list(edits) or edits == [] -> {:error, "edits must be a non-empty list"}
      true ->
        with {:ok, text} <- File.read(path) |> wrap(path),
             {:ok, new_text, applied} <- apply_edits(text, edits) do
          if dry do
            {:ok, %{"path" => path, "applied" => applied, "written" => false}}
          else
            case File.write(path, new_text) do
              :ok -> {:ok, %{"path" => path, "applied" => applied, "written" => true}}
              {:error, r} -> {:error, "write failed: #{inspect(r)}"}
            end
          end
        end
    end
  end

  defp wrap({:ok, t}, _), do: {:ok, t}
  defp wrap({:error, r}, p), do: {:error, "cannot read #{p}: #{inspect(r)}"}

  defp apply_edits(text, edits) do
    edits
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, text, []}, fn {edit, i}, {:ok, acc, applied} ->
      old = edit["old"]
      new = edit["new"]
      all = edit["replace_all"] == true

      cond do
        not is_binary(old) or old == "" or not is_binary(new) ->
          {:halt, {:error, "edit #{i}: old and new must be strings (old non-empty)"}}

        true ->
          count = length(:binary.matches(acc, old))

          cond do
            count == 0 -> {:halt, {:error, "edit #{i}: old not found"}}
            count > 1 and not all -> {:halt, {:error, "edit #{i}: old matches #{count} times"}}
            true ->
              {:cont, {:ok, String.replace(acc, old, new, global: all), applied ++ [count]}}
          end
      end
    end)
    |> case do
      {:ok, t, a} -> {:ok, t, a}
      err -> err
    end
  end
end