// @ts-nocheck — standalone LFD tooling (CLI), not typed app surface
import { pipeline, RawImage } from '@xenova/transformers';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BOOKS_DIR = 'static/pillar-library-v2/example-books';
const THRESHOLD = Number(process.argv[2]) || 0.6;

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

async function embed(path) {
  const img = await RawImage.read(path);
  const out = await extractor(img, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

const books = [];
const skipped = [];

const entries = readdirSync(BOOKS_DIR);

for (const D of entries) {
  const dir = join(BOOKS_DIR, D);
  const stat = statSync(dir);
  if (!stat.isDirectory()) continue;

  const heroPath = join(dir, 'hero-portrait.jpg');
  if (!existsSync(heroPath)) {
    skipped.push(D);
    continue;
  }

  const heroVec = await embed(heroPath);

  const spreadFiles = readdirSync(dir)
    .filter(f => /^spread-.*\.jpg$/.test(f))
    .sort();

  const perSpread = [];
  for (const spread of spreadFiles) {
    const spreadVec = await embed(join(dir, spread));
    const cos = cosine(spreadVec, heroVec);
    perSpread.push({ spread, cosine: round4(cos) });
  }

  const cosines = perSpread.map(s => s.cosine);
  const meanConsistency = round4(cosines.reduce((a, b) => a + b, 0) / cosines.length);
  const minConsistency = round4(Math.min(...cosines));
  const flagged = perSpread.filter(s => s.cosine < THRESHOLD).map(s => s.spread);

  books.push({
    book: D,
    meanConsistency,
    minConsistency,
    nSpreads: perSpread.length,
    flagged,
    perSpread
  });
}

const meanConsistencyAcrossBooks = books.length > 0
  ? round4(books.reduce((a, b) => a + b.meanConsistency, 0) / books.length)
  : 0;

const overall = {
  threshold: THRESHOLD,
  nBooks: books.length,
  meanConsistencyAcrossBooks,
  totalFlaggedSpreads: books.reduce((a, b) => a + b.flagged.length, 0),
  skipped
};

console.log(JSON.stringify({ overall, books }, null, 2));
