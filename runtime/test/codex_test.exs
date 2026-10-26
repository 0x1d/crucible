defmodule Runtime.CodexTest do
  use ExUnit.Case, async: false

  test "load_meta tolerates invalid meta.json" do
    root =
      Path.join(System.tmp_dir!(), "alchemist-codex-#{System.unique_integer([:positive])}")

    slug_dir = Path.join(root, "bad_meta")
    File.mkdir_p!(slug_dir)
    File.write!(Path.join(slug_dir, "meta.json"), "not json")

    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    try do
      assert Runtime.Codex.load_meta("bad_meta") == %{
               "name" => "bad_meta",
               "loaded" => false
             }
    after
      if previous do
        System.put_env("AGENT_FUNCTIONS_DIR", previous)
      else
        System.delete_env("AGENT_FUNCTIONS_DIR")
      end

      File.rm_rf!(root)
    end
  end
end
