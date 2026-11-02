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
  end

  # The bridge exports ALCHEMIST_OWNER_PID, and `mix test` may inherit it, so pin
  # the variable per case and restore it afterwards.
  test "owner watch status follows ALCHEMIST_OWNER_PID" do
    previous = System.get_env("ALCHEMIST_OWNER_PID")

    on_exit(fn ->
      if previous,
        do: System.put_env("ALCHEMIST_OWNER_PID", previous),
        else: System.delete_env("ALCHEMIST_OWNER_PID")
    end)

    System.delete_env("ALCHEMIST_OWNER_PID")
    assert Runtime.OwnerWatch.status() == :absent

    System.put_env("ALCHEMIST_OWNER_PID", "not-a-pid")
    assert Runtime.OwnerWatch.status() == :absent

    System.put_env("ALCHEMIST_OWNER_PID", System.pid())
    assert Runtime.OwnerWatch.status() == :alive

    pid_max = "/proc/sys/kernel/pid_max" |> File.read!() |> String.trim()
    System.put_env("ALCHEMIST_OWNER_PID", pid_max)
    assert Runtime.OwnerWatch.status() == :dead
  end
end
