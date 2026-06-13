// @ts-nocheck — standalone LFD tooling script (CLI/eval), not part of the typed app surface
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function countSyllables(word) {
  const lower = word.toLowerCase();
  const matches = lower.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 0;
  if (lower.endsWith('e')) {
    const withoutE = lower.slice(0, -1);
    const matchesWithoutE = withoutE.match(/[aeiouy]+/g);
    const countWithoutE = matchesWithoutE ? matchesWithoutE.length : 0;
    if (countWithoutE < count) {
      count -= 1;
    }
  }
  return Math.max(1, count);
}

function round4(num) {
  return Math.round(num * 10000) / 10000;
}

export function extractStoryFeatures(text) {
  if (!text || typeof text !== 'string') {
    return {
      sentenceCount: 0,
      wordCount: 0,
      avgWordsPerSentence: 0,
      avgSyllablesPerWord: 0,
      fleschReadingEase: 0,
      typeTokenRatio: 0,
      avgWordLength: 0,
      dialogueRatio: 0,
      exclaimQuestionRatio: 0,
      refrainScore: 0,
      repetitionScore: 0,
    };
  }

  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const sentenceCount = sentences.length;

  const wordRegex = /[\p{L}'']+/gu;
  const allWords = text.match(wordRegex) || [];
  const wordCount = allWords.length;

  const avgWordsPerSentence = wordCount / Math.max(1, sentenceCount);

  let totalSyllables = 0;
  let totalWordLength = 0;
  const lowerWords = [];
  for (const word of allWords) {
    totalSyllables += countSyllables(word);
    totalWordLength += word.length;
    lowerWords.push(word.toLowerCase());
  }
  const avgSyllablesPerWord = wordCount > 0 ? totalSyllables / wordCount : 0;

  const fleschRaw = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
  const fleschReadingEase = Math.max(0, Math.min(120, fleschRaw));

  const distinctWords = new Set(lowerWords);
  const typeTokenRatio = wordCount > 0 ? distinctWords.size / wordCount : 0;

  const avgWordLength = wordCount > 0 ? totalWordLength / wordCount : 0;

  const quoteChars = /["'\u201C\u201D\u2018\u2019]/;
 let dialogueCount = 0;
  for (const sentence of sentences) {
    if (quoteChars.test(sentence)) {
      dialogueCount += 1;
    }
  }
  const dialogueRatio = sentenceCount > 0 ? dialogueCount / sentenceCount : 0;

  const exclaimCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  const exclaimQuestionRatio = (exclaimCount + questionCount) / Math.max(1, sentenceCount);

  let refrainScore = 0;
  if (lowerWords.length >= 4) {
    const ngramCounts = new Map();
    for (let i = 0; i <= lowerWords.length - 4; i++) {
      const ngram = lowerWords.slice(i, i + 4).join(' ');
      ngramCounts.set(ngram, (ngramCounts.get(ngram) || 0) + 1);
    }
    let maxCount = 0;
    for (const count of ngramCounts.values()) {
      if (count > maxCount) {
        maxCount = count;
      }
    }
    refrainScore = maxCount / Math.max(1, sentenceCount);
  }

  let repetitionScore = 0;
  if (sentences.length > 0) {
    const seenSentences = new Set();
    let duplicateCount = 0;
    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenSentences.has(normalized)) {
        duplicateCount += 1;
      } else {
        seenSentences.add(normalized);
      }
    }
    repetitionScore = duplicateCount / sentences.length;
  }

  return {
    sentenceCount: round4(sentenceCount),
    wordCount: round4(wordCount),
    avgWordsPerSentence: round4(avgWordsPerSentence),
    avgSyllablesPerWord: round4(avgSyllablesPerWord),
    fleschReadingEase: round4(fleschReadingEase),
    typeTokenRatio: round4(typeTokenRatio),
    avgWordLength: round4(avgWordLength),
    dialogueRatio: round4(dialogueRatio),
    exclaimQuestionRatio: round4(exclaimQuestionRatio),
    refrainScore: round4(refrainScore),
    repetitionScore: round4(repetitionScore),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filePath = process.argv[2];
  const text = readFileSync(filePath, 'utf-8');
  const features = extractStoryFeatures(text);
  console.log(JSON.stringify(features, null, 2));
}
