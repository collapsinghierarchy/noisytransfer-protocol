#!/usr/bin/env node
import { execSync } from "node:child_process";
try {
  execSync("npx -y tsc -p tsconfig.declarations.json", { stdio: "inherit" });
} catch (e) {
  // We still want d.ts even if TS complains about JS types; emitDeclarationOnly + noEmitOnError=false by default in CLI
  process.exitCode = 0;
}
