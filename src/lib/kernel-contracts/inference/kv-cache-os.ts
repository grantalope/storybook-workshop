// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import type { ChatRequest, ChatResponse } from '$lib/llr';

export interface KVCacheSession {
  key: string;
  prefixHash: string;
  model?: string;
  createdAt: number;
  lastUsedAt: number;
  promptTokens: number;
  completionTokens: number;
  estimatedBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  lastLabel?: string;
}

export interface KVCachePlan {
  sessionKey: string;
  prefixHash: string;
  hit: boolean;
  estimatedPromptTokens: number;
  estimatedBytes: number;
  evicted: string[];
}

export interface KVCacheOSSnapshot {
  maxSessions: number;
  maxBytes: number;
  totalBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  sessions: KVCacheSession[];
}

export interface KVCacheOSOpts {
  namespace?: string;
  maxSessions?: number;
  maxBytes?: number;
  tokenBytes?: number;
  now?: () => number;
}

const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TOKEN_BYTES = 2 * 1024;

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function canonicalMessage(msg: { role?: string; content?: unknown }): string {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
  return `${msg.role ?? 'unknown'}:${content.trim()}`;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function promptPrefix(req: ChatRequest): string {
  const messages = req.messages ?? [];
  const prefixMessages = messages.length > 1 ? messages.slice(0, -1) : messages;
  const controls = {
    engine: req.engine ?? '',
    schemaType: req.schemaType ?? '',
    tools: req.tools ?? null,
    responseFormat: req.responseFormat ?? null,
  };
  return `${JSON.stringify(controls)}\n${prefixMessages.map(canonicalMessage).join('\n')}`;
}

function estimatePromptTokens(req: ChatRequest): number {
  return (req.messages ?? [])
    .map(canonicalMessage)
    .reduce((sum, text) => sum + estimateTokens(text), 0);
}

export class KVCacheOS {
  private readonly sessions = new Map<string, KVCacheSession>();
  private readonly namespace: string;
  private readonly maxSessions: number;
  private readonly maxBytes: number;
  private readonly tokenBytes: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(opts: KVCacheOSOpts = {}) {
    this.namespace = opts.namespace ?? 'kernel-llm';
    this.maxSessions = Math.max(1, Math.floor(opts.maxSessions ?? DEFAULT_MAX_SESSIONS));
    this.maxBytes = Math.max(1, Math.floor(opts.maxBytes ?? DEFAULT_MAX_BYTES));
    this.tokenBytes = Math.max(1, Math.floor(opts.tokenBytes ?? DEFAULT_TOKEN_BYTES));
    this.now = opts.now ?? (() => Date.now());
  }

  planRequest(req: ChatRequest): KVCachePlan {
    const prefix = promptPrefix(req);
    const prefixHash = fnv1a(prefix);
    const model = req.engine ?? 'active';
    const sessionKey = req.sessionKey ?? `${this.namespace}:${model}:${prefixHash}`;
    const estimatedPromptTokens = estimatePromptTokens(req);
    const estimatedBytes = Math.max(1, estimatedPromptTokens * this.tokenBytes);
    const now = this.now();
    let session = this.sessions.get(sessionKey);
    const hit = !!session && session.prefixHash === prefixHash;

    if (hit && session) {
      session.hits++;
      session.lastUsedAt = now;
      session.lastLabel = req.label;
      this.hits++;
    } else {
      session = {
        key: sessionKey,
        prefixHash,
        model,
        createdAt: now,
        lastUsedAt: now,
        promptTokens: estimatedPromptTokens,
        completionTokens: 0,
        estimatedBytes,
        hits: 0,
        misses: 1,
        evictions: 0,
        lastLabel: req.label,
      };
      this.sessions.set(sessionKey, session);
      this.misses++;
    }

    const evicted = this.enforceBudget(sessionKey);
    return { sessionKey, prefixHash, hit, estimatedPromptTokens, estimatedBytes, evicted };
  }

  applyRequest(req: ChatRequest): { request: ChatRequest; plan: KVCachePlan } {
    const plan = this.planRequest(req);
    return {
      plan,
      request: {
        ...req,
        sessionKey: req.sessionKey ?? plan.sessionKey,
      },
    };
  }

  observeCompletion(sessionKey: string, response?: ChatResponse): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    const usage = response?.usage;
    if (usage?.prompt_tokens) session.promptTokens = Math.max(session.promptTokens, usage.prompt_tokens);
    if (usage?.completion_tokens) session.completionTokens += usage.completion_tokens;
    const tokens = Math.max(session.promptTokens + session.completionTokens, 1);
    session.estimatedBytes = tokens * this.tokenBytes;
    session.lastUsedAt = this.now();
    this.enforceBudget(sessionKey);
  }

  invalidate(sessionKey: string): boolean {
    return this.sessions.delete(sessionKey);
  }

  clear(): void {
    this.sessions.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  snapshot(): KVCacheOSSnapshot {
    const sessions = Array.from(this.sessions.values())
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((session) => ({ ...session }));
    return {
      maxSessions: this.maxSessions,
      maxBytes: this.maxBytes,
      totalBytes: sessions.reduce((sum, session) => sum + session.estimatedBytes, 0),
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      sessions,
    };
  }

  private enforceBudget(protectedKey: string): string[] {
    const evicted: string[] = [];
    const victims = Array.from(this.sessions.values())
      .filter((session) => session.key !== protectedKey)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const victim of victims) {
      if (this.sessions.size <= this.maxSessions && this.totalBytes() <= this.maxBytes) break;
      this.sessions.delete(victim.key);
      victim.evictions++;
      this.evictions++;
      evicted.push(victim.key);
    }
    return evicted;
  }

  private totalBytes(): number {
    let total = 0;
    for (const session of this.sessions.values()) total += session.estimatedBytes;
    return total;
  }
}
