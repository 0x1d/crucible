defmodule RuntimeTest do
  use ExUnit.Case

  test "registry runtime modules are loaded" do
    assert Code.ensure_loaded?(Runtime.Application)
    assert Code.ensure_loaded?(Runtime.Server)
    assert Code.ensure_loaded?(Runtime.Engine)
    assert Code.ensure_loaded?(Runtime.OwnerWatch)
  end

  test "owner watch sees this OS process and rejects an impossible pid" do
    assert Runtime.OwnerWatch.alive?(System.pid() |> String.to_integer())
    pid_max = "/proc/sys/kernel/pid_max" |> File.read!() |> String.trim() |> String.to_integer()
    refute Runtime.OwnerWatch.alive?(pid_max)
    assert Runtime.OwnerWatch.status() == :absent
  end
end
