// @ts-nocheck — standalone LFD tooling (CLI), not typed app surface
import { pipeline, RawImage } from '@xenova/transformers';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST_PATH = 'static/pillar-library-v2/manifest.json';
const EXAMPLE_BOOKS_DIR = 'static/pillar-library-v2/example-books';

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

const manifestData = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const manifest = manifestData.map(entry => ({
  id: entry.archetypeId,
  emb: entry.embedding
}));
const manifestLength = manifest.length;

const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

const subdirs = readdirSync(EXAMPLE_BOOKS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && /^p\d+$/.test(d.name))
  .map(d => d.name);

const perQuery = [];
let hit1Count = 0;
let hit3Count = 0;

for (const trueId of subdirs) {
  const dirPath = join(EXAMPLE_BOOKS_DIR, trueId);
  const candidates = [
    join(dirPath, 'spread-setup.jpg'),
    join(dirPath, 'spread-trial.jpg'),
    join(dirPath, 'cover.jpg')
  ];
  let queryPath = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      queryPath = p;
      break;
    }
  }
  if (!queryPath) {
    continue;
  }

  const img = await RawImage.read(queryPath);
  const out = await extractor(img, { pooling: 'mean', normalize: true });
  const qvec = Array.from(out.data);

  const scores = manifest.map(entry => ({
    id: entry.id,
    score: cosine(qvec, entry.emb)
  }));
  scores.sort((a, b) => b.score - a.score);

  const rankIndex = scores.findIndex(s => s.id === trueId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const top3 = scores.slice(0, 3).map(s => s.id);
  const hit3 = top3.includes(trueId);

  if (rank === 1) hit1Count++;
  if (hit3) hit3Count++;

  perQuery.push({
    book: trueId,
    rank,
    top3
  });
}

const nQueries = perQuery.length;
const recall1 = nQueries > 0 ? hit1Count / nQueries : 0;
const recall3 = nQueries > 0 ? hit3Count / nQueries : 0;

const result = {
  nQueries,
  recall1,
  recall3,
  randomBaseline3: 3 / manifestLength,
  perQuery
};

console.log(JSON.stringify(result, null, 2));
