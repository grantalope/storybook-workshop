// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/lilaiputia/agentStamps.ts

// Inlined for standalone — pachinko-coupled agentVisuals lookup replaced with neutral fallback.
// Inlined: canonical agentVisuals not vendored. Proxy returns neutral gray for any property.
const AGENT_COLOR = new Proxy({} as Record<string, string>, { get: () => "#9ca3af" });

export interface AgentStamp {
  /** Single monospace char used in tight contexts (chat prefixes, small obstacles). */
  nano: string;
  /** 3-row ASCII stamp rendered in AsciiRenderer cell grid. Non-'·'/non-space = occupied cell. */
  stamp: [string, string, string];
  /** Agent brand color (hex). */
  color: string;
}

export const AGENT_STAMPS: Record<string, AgentStamp> = {
  aristotle: {
    nano: 'Φ',
    color: AGENT_COLOR.aristotle,
    stamp: ['·∴·', '∴Φ∴', '·∴·'],
  },
  napoleon: {
    nano: '╬',
    color: AGENT_COLOR.napoleon,
    stamp: ['·║·', '═╬═', '·║·'],
  },
  ada: {
    nano: '◈',
    color: AGENT_COLOR.ada,
    stamp: ['∘◦∘', '◦◈◦', '∘◦∘'],
  },
};

/** Resolve stamp for an agentId, handling aliases like 'ada_lovelace'. */
export function getStamp(agentId: string): AgentStamp | null {
  const key = agentId.toLowerCase().replace('_lovelace', '').replace('ada lovelace', 'ada');
  return AGENT_STAMPS[key] ?? null;
}
