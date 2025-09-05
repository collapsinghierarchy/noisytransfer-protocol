#!/usr/bin/env bash
set -euo pipefail

# Run from repo root: bash scripts/regenerate-types-inplace.sh

echo "🧹 Removing ALL existing declaration files under packages/*/src"
find packages -type f -name "*.d.ts" -not -path "*/node_modules/*" -delete

echo "🧼 Cleaning any stray top-level folders accidentally created by previous runs"
for dir in packages/*; do
  name=$(basename "$dir")
  if [ -d "./$name/src" ] && [ ! -d "packages/$name/src" ]; then
    echo " - Removing stray ./$name"
    rm -rf "./$name"
  fi
done

echo "➕ Ensuring TypeScript is installed"
npm i -D typescript @types/node

echo "🛠️  Emitting declarations NEXT TO each JS source (no outDir)"
npx tsc -p tsconfig.types.json

echo "✅ Done. Sample of emitted files:"
find packages -type f -name "index.d.ts" | head -n 20
