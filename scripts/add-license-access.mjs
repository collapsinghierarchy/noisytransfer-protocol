#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';


const ROOT = process.cwd();
const PACKAGES_DIR = path.join(ROOT, 'packages');
const MODE = process.argv.includes('--check') ? 'check' : 'write';
const LICENSE_VALUE = 'AGPL-3.0-only';


async function main() {
const dirs = await fs.readdir(PACKAGES_DIR, { withFileTypes: true });
const pkgDirs = dirs.filter(d => d.isDirectory());
let changed = 0;
const results = [];


for (const d of pkgDirs) {
const pkgJsonPath = path.join(PACKAGES_DIR, d.name, 'package.json');
try {
const jsonStr = await fs.readFile(pkgJsonPath, 'utf8');
const pkg = JSON.parse(jsonStr);
const before = { license: pkg.license, publishConfig: pkg.publishConfig };
let needsWrite = false;


if (!pkg.license) { pkg.license = LICENSE_VALUE; needsWrite = true; }
if (!pkg.publishConfig || pkg.publishConfig.access !== 'public') {
pkg.publishConfig = { ...(pkg.publishConfig || {}), access: 'public' };
needsWrite = true;
}


    if (MODE === 'write' && needsWrite) {
        await fs.writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    changed++;
    }


    results.push({
            name: pkg.name || d.name,
            path: `packages/${d.name}/package.json`,
            license: pkg.license || '',
            access: (pkg.publishConfig && pkg.publishConfig.access) || '',
            changed: MODE === 'write' ? needsWrite : false,
        });
        } catch (err) {
        results.push({ name: d.name, path: `packages/${d.name}/package.json`, error: err.message });
        }
    }


        console.table(results.map(r => ({
            package: r.name,
            license: r.license || '(missing)',
            access: r.access || '(missing)',
            changed: r.changed ? 'yes' : 'no',
            path: r.path,
        })));


        if (MODE === 'write') {
            console.log(`Updated ${changed} package.json file(s).`);
        } else {
            const missing = results.filter(r => !r.license || !r.access);
        if (missing.length) {
            console.error('❌ Some packages are missing license or access. Run without --check to fix.');
            process.exit(1);
        } else {
            console.log('✅ All packages have license and access public.');
        }
        
    }
}


main().catch(err => { console.error(err); process.exit(1); });