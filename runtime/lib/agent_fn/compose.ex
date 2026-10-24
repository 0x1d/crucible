defmodule AgentFn.Compose do
  @moduledoc """
  Higher-order helpers for chaining registry tools.

      AgentFn.Compose.pipeline(%{"n" => 1}, ["echo", "echo"])

  Each step receives the **result map** of the previous `{:ok, map}` and must
  return `{:ok, map}` or `{:error, reason}` from its own `run/1` when invoked
  via `AgentFn.Registry.call/2`.
  """

  alias AgentFn.Registry

  @type slug :: String.t()
  @type args :: map()
  @type step_result :: {:ok, args} | {:error, String.t()}

  @spec pipeline(args, [slug]) :: step_result
  def pipeline(initial_args, slugs) when is_map(initial_args) and is_list(slugs) do
    Enum.reduce_while(slugs, {:ok, initial_args}, fn slug, {:ok, acc} ->
      case Registry.call(slug, acc) do
        {:ok, next} when is_map(next) -> {:cont, {:ok, next}}
        {:ok, other} -> {:halt, {:error, "step #{slug} must return a map, got #{inspect(other)}"}}
        {:error, message} -> {:halt, {:error, message}}
      end
    end)
  end

  @doc """
  Run `slug` only when `predicate` returns true on the current args map.
  """
  @spec if_then(slug, (args -> boolean()), args) :: step_result
  def if_then(slug, predicate, args) when is_function(predicate, 1) and is_map(args) do
    if predicate.(args) do
      Registry.call(slug, args)
    else
      {:ok, args}
    end
  end

  @doc """
  Map over a list field in `args`, threading the field key (string).
  """
  @spec map_each(args, String.t(), slug) :: step_result
  def map_each(args, field, slug) when is_map(args) and is_binary(field) do
    case Map.get(args, field) do
      list when is_list(list) ->
        list
        |> Enum.reduce_while({:ok, []}, fn item, {:ok, acc} ->
          item_args = Map.put(args, field, item)

          case Registry.call(slug, item_args) do
            {:ok, result} -> {:cont, {:ok, acc ++ [result]}}
            {:error, message} -> {:halt, {:error, message}}
          end
        end)
        |> case do
          {:ok, results} -> {:ok, Map.put(args, field, results)}
          other -> other
        end

      _ ->
        {:error, "field #{field} must be a list"}
    end
  end
end
