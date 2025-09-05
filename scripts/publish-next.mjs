#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const order = [
  "errors",
  "util",
  "constants",
  "crypto",
  "transport",
  "noisystream",
  "noisyauth",
  "noisycache",
  "noisytransfer-protocol",
];

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const OTP = process.env.NPM_OTP || "";

for (const name of order) {
  const cwd = path.join(root, "packages", name);
  console.log(`\n— ${name} —`);
  const dry = spawnSync(npmCmd, ["publish", "--access", "public", "--tag", "next", "--dry-run"], {
    cwd,
    stdio: "inherit",
  });
  if (dry.status !== 0) process.exit(dry.status);
  const args = ["publish", "--access", "public", "--tag", "next"];
  if (OTP) args.push("--otp", OTP);
  const real = spawnSync(npmCmd, args, { cwd, stdio: "inherit" });
  if (real.status !== 0) process.exit(real.status);
}
console.log("\n✅ Published all packages under dist-tag 'next'.");
