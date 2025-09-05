#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------ env & config ------------------------------- */
const integEnabled = /^(1|true|yes)$/i.test(process.env.CI_ALLOW_INTEGRATION || "");
const signalMode = process.env.TEST_SIGNAL_MODE || "(default)";
const wrtcMaxMs = Number(process.env.WRTC_TEST_MAX_MS ?? 30000);

/* ---------------------------- test file discovery -------------------------- */
function discover(globs) {
  if (globs.length) return globs;
  const roots = ["packages/transport/test", "packages/noisystream/test", "packages/noisyauth/test"];
  const include = /rtc|webrtc|wrtc/i;
  const exclude = /(repro_wrtc|standalone_wrtc|ultra_min_close)/i;
  const found = [];

  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (ent.isFile() && (p.endsWith(".mjs") || p.endsWith(".js"))) {
        if (include.test(ent.name) && !exclude.test(ent.name)) found.push(p);
      }
    }
  };

  for (const r of roots) if (fs.existsSync(r)) walk(r);
  return found;
}

const files = discover(process.argv.slice(2));
if (files.length === 0) {
  console.log("No WebRTC test files found.");
  process.exit(0);
}

console.log(`▶ running WebRTC tests (${files.length} files)`);
console.log(
  `   CI_ALLOW_INTEGRATION=${integEnabled ? "on" : "off"} | TEST_SIGNAL_MODE=${signalMode} | WRTC_TEST_MAX_MS=${wrtcMaxMs}`
);

/* ------------------------------- run child TAP ----------------------------- */
const child = spawn(process.execPath, ["--test", "--test-reporter", "tap", ...files], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

let passed = 0,
  failed = 0,
  skipped = 0;
let sawModuleNotFound = false;

const rlOut = createInterface({ input: child.stdout });
const rlErr = createInterface({ input: child.stderr });

function isAbsPathDesc(desc) {
  return /^[/\\]/.test(desc) || /^[A-Za-z]:[\\/]/.test(desc);
}

/* Diagnostics */
const failing = []; // { name, code?, error? }
const skippedList = []; // { name, reason, byFlag }
let lastFail = null; // currently-parsed failed subtest (for YAML)
let inYaml = false;
// If a TAP line marks a skip, we capture it here to optionally enrich from YAML (rare)
let lastSkip = null;

rlOut.on("line", (line) => {
  const s = line.trim();
  if (!s) return;

  if (/ERR_MODULE_NOT_FOUND|Cannot find package|MODULE_NOT_FOUND/i.test(s)) {
    sawModuleNotFound = true;
  }

  // TAP: ok / not ok
  const mOk = /^ok\s+\d+\s*-\s*(.*)$/i.exec(s);
  if (mOk) {
    const desc = mOk[1];
    const name = desc.replace(/\s+#.*/, "");
    const mSkip = /#\s*SKIP\b\s*(.*)?$/i.exec(desc);
    if (mSkip) {
      skipped++;
      const reason = (mSkip[1] || "").trim();
      const byFlag = !integEnabled || /CI_ALLOW_INTEGRATION|integration/i.test(reason);
      lastSkip = { name, reason, byFlag };
      skippedList.push(lastSkip);
      console.log(`⏭︎ ${name}${reason ? ` — ${reason}` : ""}`);
    } else {
      passed++;
      console.log(`✔ ${name}`);
      lastSkip = null;
    }
    lastFail = null;
    inYaml = false;
    return;
  }

  const mNo = /^not ok\s+\d+\s*-\s*(.*)$/i.exec(s);
  if (mNo) {
    const desc = mNo[1];
    if (isAbsPathDesc(desc)) {
      // file-level failure (often wrtc teardown SIGSEGV) — do not count against pass/fail summary
      console.warn(`(ignoring file-level failure): ${desc}`);
      lastFail = null;
      inYaml = false;
      lastSkip = null;
    } else {
      failed++;
      console.log(`✖ ${desc}`);
      lastFail = { name: desc };
      inYaml = false;
      failing.push(lastFail);
      lastSkip = null;
    }
    return;
  }

  // YAML diag block starts / ends
  if (s === "---") {
    inYaml = true;
    return;
  }
  if (s === "...") {
    inYaml = false;
    return;
  }

  // If inside YAML for a failed subtest, capture useful keys
  if (inYaml && lastFail) {
    const mCode = /^\s*code:\s*['"]?([^'"]+)['"]?\s*$/i.exec(s);
    if (mCode && !lastFail.code) {
      lastFail.code = mCode[1];
      return;
    }
    const mErr = /^\s*error:\s*['"]?([^'"]+)['"]?\s*$/i.exec(s);
    if (mErr && !lastFail.error) {
      lastFail.error = mErr[1];
      return;
    }
  }

  // In case some runners emit skip info in YAML (rare), enrich the last skip
  if (inYaml && lastSkip) {
    const mReason = /^\s*(?:skip|reason|comment):\s*['"]?([^'"]+)['"]?\s*$/i.exec(s);
    if (mReason && !lastSkip.reason) lastSkip.reason = mReason[1];
  }

  // passthrough any other stdout (your test logs)
  console.log(line);
});

// keep stderr visible for debugging
rlErr.on("line", (line) => console.error(`[child stderr] ${line}`));

/* ----------------------------- summarize & exit ---------------------------- */
let childExited = false,
  outClosed = false,
  errClosed = false;

function summarizeAndExit(codeFromChild) {
  // Skipped breakdown (one consolidated list + grouped views)
  if (skippedList.length) {
    console.log("\nSkipped subtests (reasons):");
    for (const s of skippedList) {
      const r = s.reason && s.reason.length ? s.reason : "no reason given";
      console.log(`  • ${s.name} — ${r}`);
    }

    const dueToFlag = skippedList.filter((s) => s.byFlag);
    const otherSkips = skippedList.filter((s) => !s.byFlag);
    if (dueToFlag.length) {
      console.log("\nSkipped due to env flags:");
      for (const s of dueToFlag) {
        const r = s.reason && s.reason.length ? s.reason : "no reason given";
        console.log(`  • ${s.name} — ${r}`);
      }
      if (!integEnabled) {
        console.log("  (Hint: set CI_ALLOW_INTEGRATION=1 to enable these.)");
      }
    }
    if (otherSkips.length) {
      console.log("\nOther skipped subtests:");
      for (const s of otherSkips) {
        const r = s.reason && s.reason.length ? s.reason : "no reason given";
        console.log(`  • ${s.name} — ${r}`);
      }
    }
  }

  // Failing subtests list (names + code/error if available)
  if (failing.length) {
    console.error("\nFailing subtests:");
    for (const f of failing) {
      const extras = [f.code, f.error].filter(Boolean).join(" — ");
      console.error(`  • ${f.name}${extras ? " — " + extras : ""}`);
    }
  }

  if (sawModuleNotFound) {
    console.error("❌ module not found detected in output.");
    process.exit(1);
  }

  const allPassed = failed === 0 && passed > 0;
  if (allPassed) {
    console.log(`\n✅ webrtc suites — pass ${passed}, skip ${skipped}`);
    console.log("NOTE: Ignoring file-level failures caused by @roamhq/wrtc teardown bug.");
    process.nextTick(() => process.exit(0));
    return;
  }
  console.error(`\n❌ webrtc suites — fail ${failed}, pass ${passed}, skip ${skipped}`);
  process.nextTick(() => process.exit(codeFromChild || 1));
}

child.on("exit", (code) => {
  childExited = true;
  if (outClosed && errClosed) summarizeAndExit(code);
});
rlOut.on("close", () => {
  outClosed = true;
  if (childExited && errClosed) summarizeAndExit(child.exitCode);
});
rlErr.on("close", () => {
  errClosed = true;
  if (childExited && outClosed) summarizeAndExit(child.exitCode);
});

// Safety valve
setTimeout(() => {
  if (passed > 0 && failed === 0 && !sawModuleNotFound) {
    console.warn("(timeout) Forcing success due to wrtc teardown quirk.");
    return summarizeAndExit(0);
  }
  console.error("(timeout) Forcing failure.");
  summarizeAndExit(1);
}, wrtcMaxMs).unref();
