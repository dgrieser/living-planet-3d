// Verifies that every locale file mirrors en.json 1:1 (same keys, same value shapes).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, Array.isArray(v) ? `array[${v.length}]` : typeof v);
  }
  return out;
}

const base = flatten(load('en.json'));
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
  const other = flatten(load(file));
  const missing = [...base.keys()].filter((k) => !other.has(k));
  const extra = [...other.keys()].filter((k) => !base.has(k));
  const shape = [...base.keys()].filter((k) => other.has(k) && other.get(k) !== base.get(k));
  if (missing.length || extra.length || shape.length) {
    failed = true;
    console.error(`✖ ${file}`);
    for (const k of missing) console.error(`  missing: ${k}`);
    for (const k of extra) console.error(`  extra:   ${k}`);
    for (const k of shape) console.error(`  shape:   ${k} (${other.get(k)} vs ${base.get(k)})`);
  } else {
    console.log(`✔ ${file} mirrors en.json (${base.size} keys)`);
  }
}

process.exit(failed ? 1 : 0);
