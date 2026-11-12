#!/usr/bin/env node
/** Static checks: syntax, missing imports, external asset references. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(full);
  }
}
await walk('src');
await walk('scripts');
files.push('serve.mjs');

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    console.error(`✗ syntax: ${file}\n${result.stderr}`);
  } else {
    console.log(`✓ ${file}`);
  }
}

// Validate bare "three" and "three/addons/*" imports resolve against vendor/.
const importRe = /from\s+['"](three(?:\/addons\/[^'"]+)?)['"]/g;
for (const file of files.filter((f) => f.startsWith('src'))) {
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(importRe)) {
    const spec = match[1];
    const target = spec === 'three'
      ? 'vendor/three/three.module.js'
      : join('vendor/three/addons', spec.slice('three/addons/'.length));
    const info = await stat(target).catch(() => null);
    if (!info) {
      failed++;
      console.error(`✗ missing vendored import: ${file} -> ${spec}`);
    }
  }
}

// No remote texture/model/audio/font references.
const remoteRe = /https?:\/\/[^\s'"`)]+\.(png|jpe?g|webp|gif|glb|gltf|hdr|exr|mp3|ogg|wav|woff2?|ttf)/gi;
for (const file of files.filter((f) => f.startsWith('src'))) {
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(remoteRe)) {
    failed++;
    console.error(`✗ external asset reference: ${file} -> ${match[0]}`);
  }
}

// Required deliverable modules.
for (const file of ['index.html', 'styles.css', 'src/world.js', 'src/enemies.js', 'src/effects.js', 'src/ui.js', 'src/audio.js', 'src/touch.js']) {
  const info = await stat(file).catch(() => null);
  if (!info || info.size < 500) {
    failed++;
    console.error(`✗ missing/empty deliverable: ${file}`);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll static checks passed.');
