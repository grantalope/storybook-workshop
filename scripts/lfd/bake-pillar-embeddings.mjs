// @ts-nocheck — standalone LFD tooling (CLI), not typed app surface
import { pipeline, RawImage } from '@xenova/transformers';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST = process.argv[2] || 'static/pillar-library-v2/manifest.json';
const STATIC_ROOT = 'static';

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

for (let i = 0; i < manifest.length; i++) {
  const entry = manifest[i];
  if (i % 10 === 0) {
    console.error(`Progress: ${i}/${manifest.length} (${entry.archetypeId})`);
  }
  try {
    const img = await RawImage.read(join(STATIC_ROOT, entry.fullUrl));
    const out = await extractor(img, { pooling: 'mean', normalize: true });
    entry.embedding = Array.from(out.data);
  } catch (err) {
    console.error(`Error processing ${entry.archetypeId}: ${err.message}`);
  }
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.error(`baked ${manifest.length} embeddings, dim ${(manifest[0]?.embedding || []).length}`);
