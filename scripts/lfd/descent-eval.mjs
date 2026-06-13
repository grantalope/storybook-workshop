// @ts-nocheck — standalone LFD tooling (CLI), not typed app surface
import { pipeline, RawImage } from '@xenova/transformers';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

function l2norm(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) return v.slice();
  return v.map(x => x / norm);
}

const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');

async function embed(p) {
  const o = await extractor(await RawImage.read(p), { pooling: 'mean', normalize: true });
  return Array.from(o.data);
}

const manifestPath = join('static', 'pillar-library-v2', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const archetypes = [];
for (const entry of manifest) {
  const fullPath = join('static', entry.fullUrl);
  const thumbPath = join('static', entry.previewUrl);
  const fullVec = await embed(fullPath);
  const thumbVec = await embed(thumbPath);
  const avgVec = l2norm(fullVec.map((v, i) => (v + thumbVec[i]) / 2));
  archetypes.push({
    id: entry.archetypeId,
    baselineRep: entry.embedding,
    avgRep: avgVec
  });
}

const queries = [];
const examplesDir = join('static', 'pillar-library-v2', 'example-books');
for (const dir of readdirSync(examplesDir)) {
  const dirPath = join(examplesDir, dir);
  if (!statSync(dirPath).isDirectory()) continue;
  const trueId = dir;
  for (const file of readdirSync(dirPath)) {
    if (/^spread-.*\.jpg$/.test(file)) {
      queries.push({
        path: join(dirPath, file),
        trueId
      });
    }
  }
}

const nQueries = queries.length;

async function evaluate(reps) {
  let hits1 = 0;
  let hits3 = 0;
  for (const q of queries) {
    const qvec = await embed(q.path);
    const scored = archetypes.map(a => ({
      id: a.id,
      score: cosine(qvec, a[reps])
    }));
    scored.sort((x, y) => y.score - x.score);
    const topIds = scored.slice(0, 3).map(s => s.id);
    if (scored[0].id === q.trueId) hits1++;
    if (topIds.includes(q.trueId)) hits3++;
  }
  return {
    recall1: hits1 / nQueries,
    recall3: hits3 / nQueries
  };
}

const baseline = await evaluate('baselineRep');
const avg = await evaluate('avgRep');

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

const randomBaseline3 = 3 / archetypes.length;

const result = {
  nQueries,
  baseline: {
    recall1: round4(baseline.recall1),
    recall3: round4(baseline.recall3)
  },
  avg: {
    recall1: round4(avg.recall1),
    recall3: round4(avg.recall3)
  },
  randomBaseline3: round4(randomBaseline3),
  delta_recall3: round4(avg.recall3 - baseline.recall3)
};

console.log(JSON.stringify(result, null, 2));
