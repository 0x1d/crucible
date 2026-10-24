defmodule Runtime.CLI do
  @moduledoc """
  JSON stdin/stdout control plane for the Agent SDK harness.
  """

  alias Runtime.Engine

  def run_stdio do
    input = IO.read(:stdio, :all) |> String.trim()

    response =
      case Jason.decode(input) do
        {:ok, request} when is_map(request) -> dispatch(request)
        {:ok, _} -> error("request must be a JSON object")
        {:error, _} -> error("invalid JSON on stdin")
      end

    IO.puts(Jason.encode!(response))
  end

  def dispatch(%{"op" => "define"} = req) do
    name = Map.get(req, "name")
    source = Map.get(req, "source")
    description = Map.get(req, "description")

    with {:ok, n} <- require_string(name, "name"),
         {:ok, s} <- require_string(source, "source") do
      Engine.define(n, s, description)
    else
      {:error, message} -> error(message)
    end
  end

  def dispatch(%{"op" => "load"} = req) do
    case require_string(Map.get(req, "name"), "name") do
      {:ok, name} ->
        try do
          Engine.load(name)
        catch
          :throw, {:error, message} -> error(message)
        end

      {:error, message} ->
        error(message)
    end
  end

  def dispatch(%{"op" => "find"} = req) do
    query = Map.get(req, "query", "") |> to_string()
    Engine.find(query)
  end

  def dispatch(%{"op" => "call"} = req) do
    name = Map.get(req, "name")
    args = Map.get(req, "args", %{})

    with {:ok, n} <- require_string(name, "name") do
      if is_map(args) do
        Engine.call(n, args)
      else
        error("args must be a JSON object")
      end
    else
      {:error, message} -> error(message)
    end
  end

  def dispatch(%{"op" => op}) do
    error("unknown op: #{op}")
  end

  def dispatch(_) do
    error("missing op field")
  end

  defp require_string(value, field) do
    case value do
      s when is_binary(s) and s != "" -> {:ok, s}
      _ -> {:error, "missing or empty #{field}"}
    end
  end

  defp error(message) do
    %{ok: false, error: message}
  end
end
