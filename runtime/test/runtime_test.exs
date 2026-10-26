defmodule RuntimeTest do
  use ExUnit.Case

  test "control plane modules are loaded" do
    assert Code.ensure_loaded?(Runtime.Application)
    assert Code.ensure_loaded?(Runtime.Server)
    assert Code.ensure_loaded?(Runtime.Engine)
  end
end
