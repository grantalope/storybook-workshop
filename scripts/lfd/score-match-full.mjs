// @ts-nocheck — standalone LFD tooling (CLI), not typed app surface
import { pipeline, RawImage } from '@xenova/transformers';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const manifestPath = 'static/pillar-library-v2/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const archetypes = manifest.map(({ archetypeId, embedding }) => ({ id: archetypeId, emb: embedding }));

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

const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

async function embed(path) {
  const out = await extractor(await RawImage.read(path), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

const exampleBooksDir = 'static/pillar-library-v2/example-books';
const dirs = readdirSync(exampleBooksDir).filter(d => {
  const full = join(exampleBooksDir, d);
  return statSync(full).isDirectory() && /^p\d+$/.test(d);
});

const queries = [];
const perBookMap = new Map();

for (const trueId of dirs) {
  const dirPath = join(exampleBooksDir, trueId);
  const files = readdirSync(dirPath).filter(f => /^(spread-.*|)\.jpg$/.test(f));
  const bookRecords = [];

  for (const filename of files) {
    const imgPath = join(dirPath, filename);
    const qvec = await embed(imgPath);

    const scored = archetypes.map(({ id, emb }) => ({
      id,
      score: cosine(qvec, emb)
    }));
    scored.sort((x, y) => y.score - x.score);

    const rank = scored.findIndex(s => s.id === trueId) + 1;
    const top3 = scored.slice(0, 3).map(s => s.id);
    const hit1 = rank === 1;
    const hit3 = top3.includes(trueId);

    const record = { book: trueId, query: filename, rank, hit1, hit3 };
    queries.push(record);
    bookRecords.push(record);
  }

  const nq = bookRecords.length;
  const r3 = nq > 0 ? bookRecords.reduce((s, r) => s + (r.hit3 ? 1 : 0), 0) / nq : 0;
  perBookMap.set(trueId, { book: trueId, nQueries: nq, recall3: r3 });
}

const nQueries = queries.length;
const recall1 = nQueries > 0 ? queries.reduce((s, q) => s + (q.hit1 ? 1 : 0), 0) / nQueries : 0;
const recall3 = nQueries > 0 ? queries.reduce((s, q) => s + (q.hit3 ? 1 : 0), 0) / nQueries : 0;
const randomBaseline3 = 3 / archetypes.length;

const perBook = dirs.map(d => perBookMap.get(d));

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

const output = {
  nQueries,
  recall1: round4(recall1),
  recall3: round4(recall3),
  randomBaseline3: round4(randomBaseline3),
  perBook: perBook.map(b => ({
    book: b.book,
    nQueries: b.nQueries,
    recall3: round4(b.recall3)
  })),
  queries: queries.map(q => ({
    book: q.book,
    query: q.query,
    rank: q.rank,
    hit1: q.hit1,
    hit3: q.hit3
  }))
};

console.log(JSON.stringify(output, null, 2));
