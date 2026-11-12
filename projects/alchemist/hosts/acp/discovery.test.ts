import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeAgentLists,
  resolveSpawnSpec,
  substituteWorkspace,
  type RegistryAgent,
} from "./discovery.ts";

test("substituteWorkspace replaces template token", () => {
  assert.equal(substituteWorkspace("${workspace}/foo", "/ws"), "/ws/foo");
});

test("resolveSpawnSpec applies workspace to args and cwd", () => {
  const resolved = resolveSpawnSpec(
    {
      command: "npx",
      args: ["tsx", "${workspace}/agent.ts"],
      cwd: "${workspace}",
    },
    "/repo",
    "/harness",
  );
  assert.deepEqual(resolved.args, ["tsx", "/harness/agent.ts"]);
  assert.equal(resolved.cwd, "/harness");
});

test("mergeAgentLists overrides registry id with user entry", () => {
  const registry: RegistryAgent[] = [
    {
      id: "sdk-example",
      label: "Registry label",
      spawn: { command: "a" },
    },
  ];
  const user: RegistryAgent[] = [
    {
      id: "sdk-example",
      label: "User override",
      spawn: { command: "b" },
    },
  ];
  const merged = mergeAgentLists(registry, user);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.label, "User override");
  assert.equal(merged[0]?.source, "user");
  assert.equal(merged[0]?.spawn.command, "b");
});
