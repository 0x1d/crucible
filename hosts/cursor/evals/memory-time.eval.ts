import { defineEval, includes } from "@grok/agent-sdk/evals";

type CallInput = {
  name?: string;
  args?: Record<string, unknown>;
};

function entity(label: string): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
  return `decision/eval_${label}_${stamp}`;
}

function callInput(value: unknown): CallInput | null {
  if (value === null || typeof value !== "object") return null;
  return value as CallInput;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function succeededWith(value: unknown, needle: string): boolean {
  const text = textOf(value);
  return /"ok"\s*:\s*true/.test(text) && text.includes(needle);
}

function emptyOf(value: unknown, needle: string): boolean {
  const text = textOf(value);
  return (
    /"ok"\s*:\s*true/.test(text) &&
    !text.includes(needle) &&
    /"rows"\s*:\s*\[\s*\]/.test(text)
  );
}

function instant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00.000Z`)
    : Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function atDay(value: unknown, day: string): boolean {
  return instant(value) === Date.parse(`${day}T00:00:00.000Z`);
}

function isNow(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const ms = instant(value);
  if (ms === null) return false;
  return Math.abs(ms - Date.now()) < 24 * 60 * 60 * 1000;
}

function queryArgs(value: unknown, id: string): Record<string, unknown> | null {
  const call = callInput(value);
  if (!call || call.name !== "memory.query" || !call.args) return null;
  if (!JSON.stringify(call.args).includes(id)) return null;
  return call.args;
}

function wrote(
  value: unknown,
  id: string,
  description: string,
  window?: { from: string; to: string },
): boolean {
  const call = callInput(value);
  if (!call || call.name !== "memory.transact" || !Array.isArray(call.args?.facts)) {
    return false;
  }
  return call.args.facts.some((fact) => {
    if (fact === null || typeof fact !== "object") return false;
    const row = fact as Record<string, unknown>;
    if (row.e !== id || row.a !== "description" || row.v !== description) return false;
    if (!window) return true;
    return atDay(row.valid_from, window.from) && atDay(row.valid_to, window.to);
  });
}

export default defineEval({
  tags: ["memory", "time"],
  cases: [
    {
      id: "valid-window",
      description: "A fact is visible inside its valid-time window and hidden now.",
      async test(t) {
        const id = entity("window");
        const description = "eval winter roster";
        await t.send(
          [
            "Use call_function only. Do not define a new function.",
            "Fact keys are e, a, and v.",
            `Call call_function with name "memory.transact" and args {"reason":"eval valid window","facts":[{"e":"${id}","a":"description","v":"${description}","valid_from":"2020-01-01","valid_to":"2020-06-01"}]}.`,
            `Then call call_function with name "memory.query" and args {"valid_at":"2020-03-01","find":["v"],"where":[{"e":"${id}","a":"description","v":"?v"}]}.`,
            `Then call call_function with name "memory.query" and args {"find":["v"],"where":[{"e":"${id}","a":"description","v":"?v"}]}. Omit valid_at.`,
            `Reply with the March 2020 value. If that second query has no rows, end the reply with none.`,
          ].join(" "),
        );

        t.succeeded();
        t.calledTool("call_function", {
          input: (value) =>
            wrote(value, id, description, { from: "2020-01-01", to: "2020-06-01" }),
        });
        t.calledTool("call_function", {
          input: (value) => {
            const args = queryArgs(value, id);
            return args !== null && atDay(args.valid_at, "2020-03-01");
          },
          output: (value) => succeededWith(value, description),
        });
        t.calledTool("call_function", {
          input: (value) => {
            const args = queryArgs(value, id);
            return args !== null && isNow(args.valid_at);
          },
          output: (value) => emptyOf(value, description),
        });
        t.check(t.reply, includes(/eval winter roster/));
      },
    },
    {
      id: "as-of",
      description: "A correction hides the old fact now and leaves it at the earlier transaction.",
      async test(t) {
        const id = entity("store");
        const earlier = "eval pine store";
        const current = "eval oak store";
        await t.send(
          [
            "Use call_function only. Do not define a new function. Do not pass history.",
            "Fact keys are e, a, and v. as_of is a JSON number.",
            `Call call_function with name "memory.transact" and args {"reason":"eval correction","facts":[{"e":"${id}","a":"description","v":"${earlier}"}]}.`,
            "Read the integer tx from that result.",
            `Call call_function with name "memory.retract" and args {"reason":"eval correction","facts":[{"e":"${id}","a":"description","v":"${earlier}"}]}.`,
            `Call call_function with name "memory.transact" and args {"reason":"eval correction","facts":[{"e":"${id}","a":"description","v":"${current}"}]}.`,
            `Call call_function with name "memory.query". Set as_of to that integer tx. Use find ["v"] and where [{"e":"${id}","a":"description","v":"?v"}].`,
            `Then call call_function with name "memory.query" and args {"find":["v"],"where":[{"e":"${id}","a":"description","v":"?v"}]}. Omit as_of.`,
            `Reply with ${earlier}, then ${current}.`,
          ].join(" "),
        );

        t.succeeded();
        t.calledTool("call_function", {
          input: (value) => {
            const args = queryArgs(value, id);
            return (
              args !== null &&
              typeof args.as_of === "number" &&
              Number.isInteger(args.as_of) &&
              args.as_of >= 0
            );
          },
          output: (value) => succeededWith(value, earlier) && !textOf(value).includes(current),
        });
        t.calledTool("call_function", {
          input: (value) => {
            const args = queryArgs(value, id);
            return args !== null && (args.as_of === undefined || args.as_of === null);
          },
          output: (value) => succeededWith(value, current) && !textOf(value).includes(earlier),
        });
        t.check(t.reply, includes(/eval pine store[\s\S]*eval oak store/));
      },
    },
    {
      id: "valid-any",
      description: "valid_at any returns a fact that is not valid now.",
      async test(t) {
        const id = entity("future");
        const description = "eval lumen plan";
        await t.send(
          [
            "Use call_function only. Do not define a new function.",
            "Fact keys are e, a, and v.",
            `Call call_function with name "memory.transact" and args {"reason":"eval valid any","facts":[{"e":"${id}","a":"description","v":"${description}","valid_from":"2030-01-01","valid_to":"2030-06-01"}]}.`,
            `Then call call_function with name "memory.query" and args {"find":["v"],"where":[{"e":"${id}","a":"description","v":"?v"}]}. Omit valid_at.`,
            `Then call call_function with name "memory.query" and args {"valid_at":"any","find":["v"],"where":[{"e":"${id}","a":"description","v":"?v"}]}.`,
            `If the first query has no rows, start the reply with none. Then reply with ${description}.`,
          ].join(" "),
        );

        t.succeeded();
        t.calledTool("call_function", {
          input: (value) =>
            wrote(value, id, description, { from: "2030-01-01", to: "2030-06-01" }),
        });
        t.calledTool("call_function", {
          input: (value) => {
            const args = queryArgs(value, id);
            return args !== null && isNow(args.valid_at);
          },
          output: (value) => emptyOf(value, description),
        });
        t.calledTool("call_function", {
          input: (value) => {
            const args = queryArgs(value, id);
            return args !== null && args.valid_at === "any";
          },
          output: (value) => succeededWith(value, description),
        });
        t.check(t.reply, includes(/eval lumen plan/));
      },
    },
  ],
});
