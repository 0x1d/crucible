import { chromium } from "playwright";
import fs from "fs";

const outDir = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(outDir, { recursive: true });

const UI_URL = process.env.NSHDE_UI_URL ?? "http://127.0.0.1:8791/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (msg) => {
  if (msg.type() === "error") console.error("browser:", msg.text());
});

async function shot(name) {
  await assertNoOverlayError();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
}

async function assertNoOverlayError() {
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      if (t.includes("nsh hot: no module")) return false;
      if (t.includes("platform is not defined")) return false;
      const err = document.querySelector('[class*="error"], [role="alert"]');
      if (err?.textContent?.includes("Error:")) return false;
      return !t.includes("Error: nsh hot");
    },
    { timeout: 30000 },
  );
}

async function waitForShell() {
  await page.goto(UI_URL, { waitUntil: "networkidle" });
  await page.getByText("nshde", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading file…"),
    { timeout: 30000 },
  );
  await assertNoOverlayError();
  await page.getByText("Welcome to nshde").waitFor({ timeout: 30000 }).catch(() => {});
  await page.getByText("components").first().waitFor({ timeout: 10000 }).catch(() => {});
}

await waitForShell();
await shot("01-nsh-ide-home");

await page.getByRole("button", { name: /^stats-/ }).click();
await page.waitForFunction(() => !document.body.innerText.includes("Loading file…"), { timeout: 15000 });
await shot("03-stats-card-editor");

await page.getByRole("button", { name: /Mount at runtime|Module is live/i }).first().click();
await page.waitForTimeout(2000);
await shot("04-runtime-stats");

await page.getByText("Implementer", { exact: true }).click().catch(() => {});
await page.keyboard.press("Escape");
await shot("05-agent-implementer");

await page.getByPlaceholder("Describe the module to develop…").fill("Build a todo list module");
await page.getByRole("button", { name: "Develop module" }).click();
await page.getByText("Ship runtime loader", { exact: false }).waitFor({ timeout: 20000 });
await page.waitForFunction(
  () => !document.body.innerText.includes("Loading file…"),
  { timeout: 15000 },
);
await assertNoOverlayError();
await shot("06-agent-generated-todo");

await page.getByRole("button", { name: "Settings" }).click();
await page.getByText("File storage backend").waitFor({ timeout: 5000 });
await shot("07-storage-settings");

await browser.close();
console.log("Screenshots saved to", outDir);
