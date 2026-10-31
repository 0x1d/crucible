defmodule AgentFn.Env.Get do
  @moduledoc """
  Read named environment variables (no dump-all).

  Args:
  - `names` (required) — list of variable names
  - or `name` — single variable name

  Missing variables appear as `null` in `values`.
  """
  @behaviour AgentFn.Tool

  @spec run(map()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    names =
      case Map.get(args, "names") || Map.get(args, :names) do
        list when is_list(list) -> list
        _ ->
          case Map.get(args, "name") || Map.get(args, :name) do
            n when is_binary(n) -> [n]
            _ -> nil
          end
      end

    cond do
      not is_list(names) or names == [] ->
        {:error, "names (list) or name (string) is required"}

      not Enum.all?(names, &is_binary/1) ->
        {:error, "all names must be strings"}

      true ->
        values =
          Map.new(names, fn name ->
            {name, System.get_env(name)}
          end)

        {:ok, %{"values" => values, "names" => names}}
    end
  end
end