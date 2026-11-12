defmodule AgentFn.Docker.Ps do
  @moduledoc """
  List Docker containers via `docker ps`.

  Args:
  - `all` — if true, include stopped containers (default false)

  Returns `containers` as normalized maps (`id`, `name`, `image`, `status`,
  `state`, `ports`, `created`, `command`, `project`) and `count`.
  `project` is the Compose project label, or nil.
  """
  @behaviour AgentFn.Tool
  @type args :: %{
    optional(:all) => boolean()
  }

  @spec run(args()) :: {:ok, map()} | {:error, String.t()}
  def run(args) when is_map(args) do
    all? = truthy?(Map.get(args, "all") || Map.get(args, :all, false))
    argv = if all?, do: ["ps", "-a", "--format", "{{json .}}"], else: ["ps", "--format", "{{json .}}"]

    case System.cmd("docker", argv, stderr_to_stdout: true) do
      {out, 0} ->
        containers =
          out
          |> String.split("\n", trim: true)
          |> Enum.map(&decode_line/1)
          |> Enum.reject(&is_nil/1)
          |> Enum.map(&normalize/1)

        {:ok,
         %{
           all: all?,
           count: length(containers),
           containers: containers
         }}

      {out, code} ->
        {:error, "docker ps failed (exit #{code}): #{String.trim(out)}"}
    end
  rescue
    e -> {:error, Exception.message(e)}
  end

  defp truthy?(v) when v in [true, "true", "1", 1], do: true
  defp truthy?(_), do: false

  defp decode_line(line) do
    case Jason.decode(line) do
      {:ok, map} -> map
      _ -> nil
    end
  end

  defp normalize(m) do
    %{
      id: short(Map.get(m, "ID")),
      name: Map.get(m, "Names"),
      image: Map.get(m, "Image"),
      status: Map.get(m, "Status"),
      state: Map.get(m, "State"),
      ports: Map.get(m, "Ports"),
      created: Map.get(m, "RunningFor") || Map.get(m, "CreatedAt"),
      command: Map.get(m, "Command"),
      project: compose_project(Map.get(m, "Labels"))
    }
  end

  defp compose_project(labels) when is_binary(labels) do
    labels
    |> String.split(",")
    |> Enum.find_value(fn part ->
      case String.split(part, "=", parts: 2) do
        ["com.docker.compose.project", value] when value != "" -> value
        _ -> nil
      end
    end)
  end

  defp compose_project(_), do: nil

  defp short(nil), do: nil
  defp short(id) when is_binary(id), do: String.slice(id, 0, 12)
  defp short(id), do: id
end