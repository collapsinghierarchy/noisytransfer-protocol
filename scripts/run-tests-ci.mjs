#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const ROOT = process.cwd();
const PKGS = path.join(ROOT, "packages");
const ALLOW_INTEGRATION = process.env.CI_ALLOW_INTEGRATION === "1";

// Treat these filenames as integration (skip in CI unless explicitly allowed)
const INTEGRATION_PATTERNS = [
  /webrtc/i,
  /rtc/i,
  /dtls/i
];

// quick TCP check for your local WS signaler (used by tests)
function checkPort(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    const t = setTimeout(() => done(false), timeoutMs);
    s.on("connect", () => { clearTimeout(t); done(true); });
    s.on("error",   () => { clearTimeout(t); done(false); });
  });
}

async function listTests(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listTests(p));
    else if (/\.(mjs|js)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function isIntegrationFile(fp) {
  const name = path.basename(fp);
  return INTEGRATION_PATTERNS.some((re) => re.test(name));
}

async function findAllTests() {
  const pkgs = (await fs.readdir(PKGS, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => path.join(PKGS, d.name, "test"))
  ;
  const files = [];
  for (const tdir of pkgs) {
    try {
      const stat = await fs.stat(tdir).catch(() => null);
      if (!stat?.isDirectory()) continue;
      files.push(...await listTests(tdir));
    } catch {}
  }
  return files;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const all = await findAllTests();

  let allowIntegration = ALLOW_INTEGRATION;
  if (!allowIntegration) {
    // If a local signaler is running, we can optionally include integration by setting CI_ALLOW_INTEGRATION=1
    const hasSignaler = await checkPort("127.0.0.1", 1234);
    if (hasSignaler) {
      console.log("ℹ️  localhost:1234 is up. To run integration tests in CI, set CI_ALLOW_INTEGRATION=1.");
    }
  }

  const unit = all.filter(f => !isIntegrationFile(f) || ALLOW_INTEGRATION);
  const skipped = all.filter(f => isIntegrationFile(f) && !ALLOW_INTEGRATION);

  console.log(`Found ${all.length} test file(s). Running ${unit.length}.`);
  if (skipped.length) {
    console.log("⏭  Skipping integration tests:");
    for (const f of skipped) console.log("   - " + path.relative(ROOT, f));
  }

  if (unit.length === 0) {
    console.log("✅ No unit tests to run.");
    return;
  }

  // Avoid "argument list too long": run in chunks
  const CHUNK = 40;
  const batches = chunk(unit, CHUNK);
  for (const files of batches) {
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ["--test", ...files], {
        stdio: "inherit",
        env: process.env,
      });
      p.on("exit", (code) => {
        if (code) {
          const err = new Error(`Test batch failed with exit code ${code}`);
          err.code = code;
          reject(err);
        } else {
          resolve();
        }
      });
    }).catch((e) => {
      console.error(String(e));
      process.exit(e.code || 1);
    });
  }

  console.log("✅ Unit tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
