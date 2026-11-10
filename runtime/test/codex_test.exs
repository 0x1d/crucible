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

  test "refresh_metadata! keeps updated_at when tool.ex is unchanged" do
    root =
      Path.join(System.tmp_dir!(), "alchemist-codex-#{System.unique_integer([:positive])}")

    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    try do
      source = """
      defmodule AgentFn.StampCheck do
        @moduledoc "stamp check"
        @behaviour AgentFn.Tool

        @impl true
        @spec run(map()) :: {:ok, map()}
        def run(args), do: {:ok, args}
      end
      """

      {:ok, _} = Runtime.Codex.write_definition("stamp_check", source, "stamp check")
      module = Runtime.Compiler.compile_slug!("stamp_check", reload: true)

      first = Runtime.Codex.refresh_metadata!("stamp_check", module)
      assert is_binary(first["updated_at"])
      assert is_binary(first["source_sha256"])

      Process.sleep(5)
      second = Runtime.Codex.refresh_metadata!("stamp_check", module)

      assert second["updated_at"] == first["updated_at"]
      assert second["source_sha256"] == first["source_sha256"]

      changed =
        String.replace(source, "stamp check", "stamp check changed")

      File.write!(Runtime.Codex.source_path("stamp_check"), changed)
      module = Runtime.Compiler.compile_slug!("stamp_check", reload: true)
      third = Runtime.Codex.refresh_metadata!("stamp_check", module)

      assert third["updated_at"] != first["updated_at"]
      assert third["source_sha256"] != first["source_sha256"]
    after
      if previous do
        System.put_env("AGENT_FUNCTIONS_DIR", previous)
      else
        System.delete_env("AGENT_FUNCTIONS_DIR")
      end

      File.rm_rf!(root)
    end
  end

  test "define and load keep a service's schemas in meta.json" do
    root =
      Path.join(System.tmp_dir!(), "alchemist-codex-#{System.unique_integer([:positive])}")

    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    try do
      source = """
      defmodule AgentFn.Services.KeepSchema do
        @moduledoc "keep schema"
        @behaviour AgentFn.Tool

        @impl true
        def run(args), do: {:ok, args}
      end
      """

      {:ok, _} = Runtime.Codex.write_definition("services.keep_schema", source, "keep schema")
      service = %{"input_schema" => %{"type" => "object"}, "output_schema" => true}
      meta = Runtime.Codex.load_meta("services.keep_schema")

      File.write!(
        Runtime.Codex.meta_path("services.keep_schema"),
        Jason.encode!(Map.put(meta, "service", service))
      )

      module = Runtime.Compiler.compile_slug!("services.keep_schema", reload: true)
      assert Runtime.Codex.refresh_metadata!("services.keep_schema", module)["service"] == service

      {:ok, redefined} =
        Runtime.Codex.write_definition("services.keep_schema", source <> "# edit\n", "again")

      assert redefined["service"] == service
      assert redefined["description"] == "again"
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
