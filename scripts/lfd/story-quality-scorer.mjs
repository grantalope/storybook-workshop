import { extractStoryFeatures } from './extract-story-features.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WEIGHTS = {
  fleschReadingEase: 2,
  avgWordsPerSentence: 2,
  avgSyllablesPerWord: 1.5,
  refrainScore: 1.5,
  dialogueRatio: 1.5,
  typeTokenRatio: 1,
  repetitionScore: 1,
  exclaimQuestionRatio: 1,
  avgWordLength: 1,
  sentenceCount: 0.5,
  wordCount: 0.5
};

export function scoreStory(text, corpusFeatures) {
  const features = extractStoryFeatures(text);
  let sumWeightedFit = 0;
  let sumWeights = 0;
  const perFeature = {};

  for (const key of Object.keys(WEIGHTS)) {
    if (!corpusFeatures.features || !(key in corpusFeatures.features)) continue;
    const weight = WEIGHTS[key];
    const { p10, p50, p90 } = corpusFeatures.features[key];
    const v = features[key];
    const span = Math.max(p90 - p10, 1e-6);
    let fit;
    if (v >= p10 && v <= p90) {
      fit = 1;
    } else {
      const dist = v < p10 ? (p10 - v) : (v - p90);
      fit = Math.max(0, 1 - 2 * dist / span);
    }
    sumWeightedFit += weight * fit;
    sumWeights += weight;
    perFeature[key] = {
      value: v,
      fit: Math.round(fit * 10000) / 10000
    };
  }

  const score = sumWeights === 0 ? 0 : Math.round((100 * sumWeightedFit / sumWeights) * 100) / 100;

  return { score, perFeature };
}

export function extractStoryText(storyObj) {
  if (typeof storyObj === 'string') {
    return storyObj;
  }
  if (storyObj === null || typeof storyObj !== 'object') {
    return '';
  }

  const textKeys = new Set(['text', 'narration', 'line', 'prose', 'sentence', 'body', 'page', 'caption', 'storyText', 'spread_text', 'pageTurnHook', 'dialogic_prompt', 'refrain']);
  const collected = [];

  function walk(obj) {
    if (obj === null || typeof obj !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && textKeys.has(key)) {
        collected.push(value);
      } else if (typeof value === 'object' && value !== null) {
        walk(value);
      }
    }
  }

  walk(storyObj);
  return collected.join(' ');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputPath = process.argv[2];
  const featuresPath = process.argv[3] || 'static/lfd/kidlit-features.json';

  let text;
  if (inputPath.endsWith('.json')) {
    const obj = JSON.parse(readFileSync(inputPath, 'utf-8'));
    text = extractStoryText(obj);
  } else {
    text = readFileSync(inputPath, 'utf-8');
  }

  const corpusFeatures = JSON.parse(readFileSync(featuresPath, 'utf-8'));
  console.log(JSON.stringify(scoreStory(text, corpusFeatures), null, 2));
}
