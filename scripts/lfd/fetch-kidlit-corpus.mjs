import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const IDS = [11,12,55,54,2591,27200,11339,19087,16,289,271,28,1597,7841,503,15784,32706,17104,36,35997,19551,24,19033,521,14838,23272,14407,2781,35,25344,13180,18155,7000,1934,39106];
const OUT_DIR = 'static/lfd/kidlit-corpus';
const TARGET = Number(process.argv[2]) || 120;
const DELAY_MS = 200;
const MIN_WORDS = 150;
const MAX_WORDS = 1200;
const MAX_PER_BOOK = 6;  // diversity cap: span many authors, not 2

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256First16(text) {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return hash.slice(0, 16);
}

function stripBoilerplate(text) {
  const startMatch = text.match(/\*\*\*\s*START OF.*?\*\*\*/i);
  const endMatch = text.match(/\*\*\*\s*END OF.*?\*\*\*/i);
  
  let cleaned = text;
  if (startMatch) {
    cleaned = cleaned.slice(startMatch.index + startMatch[0].length);
  }
  if (endMatch) {
    cleaned = cleaned.slice(0, endMatch.index);
  }
  return cleaned.trim();
}

function segmentIntoChunks(text) {
  const paragraphs = text.split(/\n\s*\n+/).filter(p => p.trim().length > 0);
  const chunks = [];
  let currentChunk = [];
  let currentWordCount = 0;
  
  for (const para of paragraphs) {
    const paraWords = (para.match(/[\p{L}']+/gu) || []).length;
    currentChunk.push(para);
    currentWordCount += paraWords;
    
    if (currentWordCount >= 300) {
      chunks.push(currentChunk.join('\n\n'));
      currentChunk = [];
      currentWordCount = 0;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }
  
  return chunks;
}

function countSentenceTerminators(text) {
  return (text.match(/[.!?]/g) || []).length;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  
  const manifest = [];
  let saved = 0;
  let booksProcessed = 0;
  
  for (const id of IDS) {
    if (saved >= TARGET) break;
    
    try {
      const url = `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
      const res = await fetch(url);
      
      if (!res.ok) {
        console.error(`[id ${id}] fetch failed: ${res.status} ${res.statusText}`);
        continue;
      }
      
      const text = await res.text();
      const cleaned = stripBoilerplate(text);
      const chunks = segmentIntoChunks(cleaned);
      
      let keptForBook = 0;
      let chunkIndex = 0;
      
      for (const chunk of chunks) {
        if (saved >= TARGET || keptForBook >= MAX_PER_BOOK) break;
        
        const wordCount = (chunk.match(/[\p{L}']+/gu) || []).length;
        const sentenceTerminators = countSentenceTerminators(chunk);
        
        if (wordCount >= MIN_WORDS && wordCount <= MAX_WORDS && sentenceTerminators >= 3) {
          const paddedIndex = String(chunkIndex).padStart(3, '0');
          const filename = `${id}-${paddedIndex}.txt`;
          const filepath = join(OUT_DIR, filename);
          
          writeFileSync(filepath, chunk, 'utf8');
          
          manifest.push({
            id: String(id),
            chunk: chunkIndex,
            words: wordCount,
            sha256_16: sha256First16(chunk)
          });
          
          saved++;
          keptForBook++;
        }
        
        chunkIndex++;
      }
      
      booksProcessed++;
      console.error(`[id ${id}] kept ${keptForBook} chunks, total saved ${saved}`);
      
      await delay(DELAY_MS);
    } catch (err) {
      console.error(`[id ${id}] error: ${err.message}`);
      continue;
    }
  }
  
  const manifestPath = join(OUT_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  
  console.error(`saved ${saved} chunks from ${booksProcessed} books -> ${OUT_DIR}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
