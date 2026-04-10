import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

async function importPlaywright() {
  try {
    const mod = await import("@playwright/test");
    return mod;
  } catch (err) {
    console.error("Playwright not installed. Run: pnpm add -D @playwright/test");
    process.exit(1);
  }
}

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "pipe", ...opts });
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  return child;
}

async function findFreePort(start = 4173, limit = 20) {
  for (let port = start; port < start + limit; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  return null;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return true;
    } catch (err) {
      // ignore
    }
    await delay(300);
  }
  return false;
}

async function main() {
  const { chromium } = await importPlaywright();
  const build = run("pnpm", ["build"]);
  await new Promise((resolve, reject) => {
    build.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm build failed with code ${code}`));
    });
  });

  const port = await findFreePort();
  if (!port) {
    console.error("No free port found for preview.");
    process.exit(1);
  }
  const server = run("pnpm", [
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ]);

  const computeEnabled = process.env.PBP_GPU_COMPUTE === "1";
  const steps = process.env.PBP_GPU_STEPS;
  const view = process.env.PBP_GPU_VIEW;
  const views = process.env.PBP_GPU_VIEWS?.split(",").map((v) => v.trim()).filter(Boolean);
  const fixtures = process.env.PBP_GPU_FIXTURES?.split(",").map((v) => v.trim()).filter(Boolean);
  const queryBase = new URLSearchParams();
  if (computeEnabled) queryBase.set("compute", "1");
  if (steps) queryBase.set("steps", steps);
  const baseUrl = `http://127.0.0.1:${port}/pbp-gpu-test.html`;
  const ready = await waitForServer(`${baseUrl}?${queryBase.toString()}`);
  if (!ready) {
    console.error("Dev server did not start in time.");
    server.kill("SIGTERM");
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU"],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "warning" || type === "error") {
      console.log(`[browser:${type}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log("[browser:pageerror]", err.message);
  });
  const viewList = views?.length ? views : view ? [view] : [null];
  const fixtureList = fixtures?.length ? fixtures : [null];
  let results = null;
  for (const f of fixtureList) {
    for (const v of viewList) {
      const params = new URLSearchParams(queryBase.toString());
      if (v) params.set("view", v);
      if (f) params.set("fixture", f);
      const url = `${baseUrl}${params.toString() ? `?${params.toString()}` : ""}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__pbpTestResults, null, { timeout: 20000 });
      results = await page.evaluate(() => window.__pbpTestResults);
      if (v) {
        const diffStats = await page.evaluate(() => window.__pbpVisual?.getDiffStats?.());
        if (!diffStats) {
          console.error("Missing diff stats for visual validation.");
          process.exit(2);
        }
        if (diffStats.max > 0) {
          console.error(`Visual diff detected for view=${v} fixture=${f}:`, diffStats);
          process.exit(2);
        }
      }
    }
  }

  console.log("PBP GPU Test Results:", JSON.stringify(results, null, 2));
  await browser.close();

  server.kill("SIGTERM");

  if (!results || results.gpuAvailable === false || results.pass === false) {
    process.exit(2);
  }
  if (computeEnabled && results.gpuComputeEnabled !== true) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
