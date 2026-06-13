import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractStoryFeatures } from './extract-story-features.mjs';

const CORPUS_DIR = process.argv[2] || 'static/lfd/kidlit-corpus';

function percentile(sortedArr, q) {
  const n = sortedArr.length;
  const idx = Math.min(Math.max(Math.round((n - 1) * q), 0), n - 1);
  return sortedArr[idx];
}

function computeStats(values) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return {
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    mean,
    std,
    min,
    max
  };
}

function round4(num) {
  return Math.round(num * 10000) / 10000;
}

const files = readdirSync(CORPUS_DIR).filter(f => f.endsWith('.txt'));

if (files.length === 0) {
  console.error('no corpus .txt found');
  process.exit(1);
}

const featureValues = {};

for (const file of files) {
  const path = join(CORPUS_DIR, file);
  const text = readFileSync(path, 'utf-8');
  const features = extractStoryFeatures(text);
  for (const [key, value] of Object.entries(features)) {
    if (typeof value !== 'number') continue;
    if (!featureValues[key]) {
      featureValues[key] = [];
    }
    featureValues[key].push(value);
  }
}

const stats = {};
for (const [key, values] of Object.entries(featureValues)) {
  const rawStats = computeStats(values);
  stats[key] = {};
  for (const [statKey, statValue] of Object.entries(rawStats)) {
    stats[key][statKey] = round4(statValue);
  }
}

const output = {
  n: files.length,
  generatedFrom: CORPUS_DIR,
  features: stats
};

const outputPath = 'static/lfd/kidlit-features.json';
writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

console.error(`features from ${files.length} stories -> ${outputPath}`);
