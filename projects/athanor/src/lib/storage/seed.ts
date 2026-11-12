export const SEED_FILES: Record<string, string> = {
  "components/welcome.nsh.tsx": `export default function Welcome() {
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-zinc-600 p-6 text-center">
      <p className="text-lg font-medium text-zinc-100">Welcome to nshde</p>
      <p className="text-sm text-zinc-400 max-w-md mx-auto">
        Prompt an agent to build an NSH shell component. It will be saved to storage
        and mounted here at runtime.
      </p>
    </div>
  );
}
`,
  "components/stats-card.nsh.tsx": `import { useMemo } from "react";

export default function StatsCard() {
  const metrics = useMemo(
    () => [
      { label: "Modules", value: 2 },
      { label: "Agents", value: 3 },
      { label: "Targets", value: "web" },
    ],
    [],
  );
  return (
    <div className="grid grid-cols-3 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg bg-zinc-800/80 px-3 py-2 text-center">
          <div className="text-xs uppercase tracking-wide text-zinc-500">{m.label}</div>
          <div className="text-xl font-semibold text-sky-400">{m.value}</div>
        </div>
      ))}
    </div>
  );
}
`,
  "manifest.json": JSON.stringify(
    {
      name: "nshde",
      version: "0.1.0",
      runtimeEntry: "components/welcome.nsh.tsx",
      capabilities: ["ui.render", "storage.read"],
    },
    null,
    2,
  ),
};
