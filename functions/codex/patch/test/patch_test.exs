defmodule AgentFn.Codex.PatchTest do
  # Not async: points AGENT_FUNCTIONS_DIR at a temp codex for the duration.
  use ExUnit.Case, async: false

  alias AgentFn.Codex.Patch
  alias Runtime.Codex

  @slug "scratch.patch_probe"
  @module AgentFn.Scratch.PatchProbe

  @source """
  defmodule AgentFn.Scratch.PatchProbe do
    @moduledoc "Patch probe. Version one."

    @spec run(map()) :: {:ok, map()}
    def run(_args), do: {:ok, %{"version" => 1, "greeting" => "hello"}}
  end
  """

  setup do
    previous = System.get_env("AGENT_FUNCTIONS_DIR")
    root = Path.join(System.tmp_dir!(), "codex-patch-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    System.put_env("AGENT_FUNCTIONS_DIR", root)

    on_exit(fn ->
      if previous, do: System.put_env("AGENT_FUNCTIONS_DIR", previous), else: System.delete_env("AGENT_FUNCTIONS_DIR")
      File.rm_rf!(root)
      :code.purge(@module)
      :code.delete(@module)
    end)

    assert %{ok: true} = Runtime.Engine.define(@slug, @source, nil)
    %{path: Codex.source_path(@slug)}
  end

  defp sha(path), do: :crypto.hash(:sha256, File.read!(path)) |> Base.encode16(case: :lower)
  defp meta, do: Codex.load_meta(@slug)
  defp probe_run, do: apply(@module, :run, [%{}])

  defp bump_edits do
    [
      %{"old" => ~s("version" => 1), "new" => ~s("version" => 2)},
      %{"old" => "Version one.", "new" => "Version two."}
    ]
  end

  test "dry_run returns a diff and writes nothing", %{path: path} do
    before = File.read!(path)

    assert {:ok, result} = Patch.run(%{"slug" => @slug, "edits" => bump_edits(), "dry_run" => true})

    assert result["dry_run"] == true
    assert result["applied"] == [%{"edit" => 1, "matches" => 1}, %{"edit" => 2, "matches" => 1}]
    assert result["diff"] =~ ~s|-  def run(_args), do: {:ok, %{"version" => 1|
    assert result["diff"] =~ ~s|+  def run(_args), do: {:ok, %{"version" => 2|
    assert File.read!(path) == before
    assert {:ok, %{"version" => 1}} = probe_run()
  end

  test "applies edits, recompiles, and resyncs meta.json", %{path: path} do
    before_meta = meta()

    assert {:ok, result} = Patch.run(%{"slug" => @slug, "edits" => bump_edits()})

    assert {:ok, %{"version" => 2}} = probe_run()
    after_meta = meta()
    assert after_meta["source_sha256"] == sha(path)
    assert after_meta["source_sha256"] != before_meta["source_sha256"]
    assert after_meta["moduledoc"] == "Patch probe. Version two."
    assert result["function"]["source_sha256"] == sha(path)
  end

  test "refuses an ambiguous match and writes nothing", %{path: path} do
    before = File.read!(path)

    assert {:error, msg} = Patch.run(%{"slug" => @slug, "edits" => [%{"old" => "\"", "new" => "'"}]})
    assert msg =~ "edit 1"
    assert msg =~ "matches"
    assert File.read!(path) == before
  end

  test "replace_all replaces every match", %{path: path} do
    assert {:ok, result} =
             Patch.run(%{
               "slug" => @slug,
               "edits" => [%{"old" => "hello", "new" => "hi", "replace_all" => true}]
             })

    assert [%{"matches" => 1}] = result["applied"]
    assert File.read!(path) =~ ~s("greeting" => "hi")
  end

  test "refuses when old text is not found", %{path: path} do
    before = File.read!(path)

    assert {:error, msg} =
             Patch.run(%{"slug" => @slug, "edits" => [%{"old" => "no such text", "new" => "x"}]})

    assert msg =~ "not found"
    assert File.read!(path) == before
  end

  test "a later edit that fails leaves the file untouched", %{path: path} do
    before = File.read!(path)

    edits = [
      %{"old" => "Version one.", "new" => "Version two."},
      %{"old" => "missing", "new" => "x"}
    ]

    assert {:error, msg} = Patch.run(%{"slug" => @slug, "edits" => edits})
    assert msg =~ "edit 2"
    assert File.read!(path) == before
  end

  test "compile failure restores the original file; module and meta unchanged", %{path: path} do
    before = File.read!(path)
    before_meta = meta()

    assert {:error, msg} =
             Patch.run(%{
               "slug" => @slug,
               "edits" => [%{"old" => "def run(_args), do:", "new" => "def run(_args) do do do"}]
             })

    assert msg =~ "compile failed, original restored"
    assert File.read!(path) == before
    assert meta()["source_sha256"] == before_meta["source_sha256"]
    assert meta()["source_sha256"] == sha(path)
    assert {:ok, %{"version" => 1}} = probe_run()
  end

  test "rejects a no-op patch" do
    assert {:error, msg} =
             Patch.run(%{"slug" => @slug, "edits" => [%{"old" => "hello", "new" => "hello"}]})

    assert msg =~ "no change"
  end

  test "validates arguments" do
    assert {:error, _} = Patch.run(%{"edits" => bump_edits()})
    assert {:error, _} = Patch.run(%{"slug" => @slug})
    assert {:error, _} = Patch.run(%{"slug" => @slug, "edits" => []})
    assert {:error, _} = Patch.run(%{"slug" => @slug, "edits" => [%{"old" => "", "new" => "x"}]})
    assert {:error, msg} = Patch.run(%{"slug" => "no.such_entry", "edits" => bump_edits()})
    assert msg =~ "cannot read"
  end
end
