defmodule AgentFn.Docker.PsReportTest do
  use ExUnit.Case, async: true

  alias AgentFn.Docker.PsReport

  test "summarize counts by image, state, and project and keeps ports only" do
    containers = [
      %{
        image: "a:1",
        state: "running",
        project: "demo",
        name: "web",
        ports: "0.0.0.0:80->80/tcp"
      },
      %{image: "a:1", state: "running", project: "demo", name: "worker", ports: ""},
      %{image: "b:2", state: "exited", project: nil, name: "old", ports: nil}
    ]

    summary = PsReport.summarize(containers)

    assert summary.count == 3
    assert summary.by_image == %{"a:1" => 2, "b:2" => 1}
    assert summary.by_state == %{"running" => 2, "exited" => 1}
    assert summary.by_project == %{"demo" => 2, "(none)" => 1}
    assert summary.published_ports == [%{name: "web", ports: "0.0.0.0:80->80/tcp"}]
    refute Map.has_key?(summary, :containers)
  end
end
