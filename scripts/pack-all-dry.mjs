#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';


const ROOT = process.cwd();
const PKGS = path.join(ROOT, 'packages');
const dirs = (await fs.readdir(PKGS, { withFileTypes: true })).filter(d => d.isDirectory());


function lineLooksLikeFile(s) {
// crude but effective: after the size token, the last token should be a path with a dot or slash
if (!s.startsWith('npm notice ')) return false;
const rest = s.slice('npm notice '.length).trim();
if (rest.includes('===') || rest.includes(':')) return false;
const parts = rest.split(' ').filter(Boolean);
if (parts.length < 2) return false;
const last = parts[parts.length - 1];
return last.includes('/') || last.includes('.') || last.includes('-');
}


function extractPath(s) {
const rest = s.slice('npm notice '.length).trim();
const parts = rest.split(' ').filter(Boolean);
return parts[parts.length - 1];
}


function looksSuspicious(p) {
const lower = p.toLowerCase();
return lower.includes('test') || lower.includes('__tests__') || lower.includes('spec') || lower.includes('bench') || lower.includes('coverage') || lower.includes('playground') || lower.includes('example');
}


let bad = [];
for (const d of dirs) {
const pkgDir = path.join(PKGS, d.name);
const res = spawnSync('npm', ['pack', '--dry-run'], { cwd: pkgDir, encoding: 'utf8' });
if (res.status !== 0) {
console.error('❌ ' + d.name + ': npm pack failed');
console.error(res.stderr || res.stdout);
process.exitCode = 1;
continue;
}
const files = res.stdout.split('\n').filter(lineLooksLikeFile).map(extractPath);
const suspicious = files.filter(looksSuspicious);
const name = d.name;
console.log('\n—— ' + name + ' ——');
console.log(files.length + ' files will be published.');
if (suspicious.length) {
console.log('⚠️ Suspicious files:');
for (const f of suspicious) console.log(' - ' + f);
bad.push({ name, count: suspicious.length });
} else {
console.log('✅ Looks clean (no tests/benches/examples).');
}
}


if (bad.length) {
console.log('\nSummary:');
for (const b of bad) console.log(' - ' + b.name + ': ' + b.count + ' suspicious file(s)');
process.exitCode = 2;
} else {
console.log('\n✅ All packages look clean.');
}