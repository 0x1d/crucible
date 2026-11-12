import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

export interface PreviewBundle {
  html: string;
  js: string;
  css: string;
}

/**
 * The IDE shows this page in a WebView. On the web target a same-origin WebView
 * is sandboxed without `allow-same-origin`, so its origin is opaque and a
 * `type="module"` script (which always uses CORS) is refused. A classic script
 * still runs there, and the page then fetches module source from `/api`.
 */
export async function buildPreviewBundle(): Promise<PreviewBundle> {
  const root = join(import.meta.dir, "../..");
  const result = await Bun.build({
    entrypoints: [join(root, "src/preview/main.tsx")],
    root,
    target: "browser",
    format: "iife",
    minify: true,
    plugins: [tailwind],
  });
  if (!result.success) {
    const detail = result.logs.map((log) => String(log)).join("\n");
    throw new Error(detail || "Preview bundle failed");
  }
  let js = "";
  let css = "";
  for (const output of result.outputs) {
    if (output.path.endsWith(".css")) css += await output.text();
    else js += await output.text();
  }
  if (!js) throw new Error("Preview bundle produced no script");
  const html = await Bun.file(join(root, "preview.html")).text();
  return { html, js, css };
}
