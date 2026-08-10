// Re-downloads the wiki DPS calc data JSONs (and any missing equipment icons)
// from upstream main. Engine source stays pinned to the commit in VENDOR.md;
// bump that manually when upstream formulas change.
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const RAW = 'https://raw.githubusercontent.com/weirdgloop/osrs-dps-calc/main';
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const project = path.join(root, '..');

const jsonFiles = ['equipment.json', 'monsters.json', 'equipment_aliases.json', 'spells.json'];

for (const f of jsonFiles) {
  const res = await fetch(`${RAW}/cdn/json/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(path.join(project, 'cdn', 'json', f), text);
  console.log(`updated cdn/json/${f} (${(text.length / 1024).toFixed(0)} KB)`);
}

// Fetch icons for any equipment whose image file is missing locally
const equipment = JSON.parse(await (await fetch(`${RAW}/cdn/json/equipment.json`)).text());
const iconDir = path.join(project, 'public', 'cdn', 'equipment');
await mkdir(iconDir, { recursive: true });
let fetched = 0;
for (const item of equipment) {
  if (!item.image) continue;
  const dest = path.join(iconDir, item.image);
  try {
    await access(dest);
  } catch {
    const res = await fetch(`${RAW}/cdn/equipment/${encodeURIComponent(item.image)}`);
    if (!res.ok) {
      console.warn(`icon missing upstream: ${item.image}`);
      continue;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    fetched += 1;
  }
}
console.log(`fetched ${fetched} new equipment icons`);
