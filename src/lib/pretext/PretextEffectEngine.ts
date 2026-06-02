// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/lilaiputia/PretextEffectEngine.ts
import { flowTextAroundObstacles } from '$lib/pretext/PretextFlowEngine';
import type { AnimatedObstacle } from '$lib/pretext/PretextFlowEngine';

export type EffectMode =
  | 'flow' | 'wave' | 'magnetic' | 'gravity' | 'bounce-in' | 'rise' | 'orbit'
  | 'scatter' | 'glitch' | 'vortex' | 'parting-water' | 'dragon';

export interface PretextEffect {
  mode: EffectMode;
  text: string;
  containerWidth: number;
  containerHeight: number;
  obstacles?: AnimatedObstacle[];
  originX?: number;
  originY?: number;
  onComplete?: () => void;
}

export interface CharState {
  char: string;
  x: number; y: number;
  targetX: number; targetY: number;
  vx: number; vy: number;
  opacity: number;
  phase?: number;
  angle?: number;
  orbitR?: number;
  orbitCX?: number;
  orbitCY?: number;
  glitchTimer?: number;
  resolvedChar?: string;
}

export interface PositionedCharInput {
  char: string; x: number; y: number; font: string; color: string;
  opacity: number; zIndex: number; elementId: string;
  effectState?: CharState;
}

export interface TickParams {
  time?: number;
  cursorX?: number;
  cursorY?: number;
  scatterPhase?: 'flying' | 'returning';
  glitchIntensity?: number;
  sweepX?: number;
  sweepY?: number;
  amplitude?: number;
  period?: number;
  orbitSpeed?: number;
}

const CHAR_W = 8;
const LINE_H = 14;
const NOISE_GLYPHS = ['▒', '░', '▓', '█', '╬', '╫', '?', '#'];

const RATE_LIMITS: Partial<Record<EffectMode, number | 'session'>> = {
  scatter: 60_000,
  glitch: 30_000,
  vortex: 120_000,
  'parting-water': 15_000,
  dragon: 'session',
};

export class PretextEffectEngine {
  private usageLog = new Map<string, number>(); // key = `${mode}:${panelId}`
  private dragonFired = false;

  /** Lay out chars into initial positions for the given effect. */
  async layout(effect: PretextEffect): Promise<CharState[]> {
    const { mode, text, containerWidth, containerHeight, obstacles } = effect;

    if (mode === 'flow' && obstacles && obstacles.length > 0) {
      // Use actual pretext layout for flow mode
      try {
        const result = await flowTextAroundObstacles(text, obstacles, {
          font: `${LINE_H}px "Courier New", monospace`,
          containerWidth,
          lineHeight: LINE_H,
        });
        const chars: CharState[] = [];
        for (const line of result.lines) {
          for (let i = 0; i < line.text.length; i++) {
            const x = line.x + i * CHAR_W;
            const y = line.y;
            chars.push({ char: line.text[i], x, y, targetX: x, targetY: y, vx: 0, vy: 0, opacity: 1, phase: Math.random() * Math.PI * 2 });
          }
        }
        return chars;
      } catch { /* fall through to monospace */ }
    }

    // Monospace grid layout for all other modes
    const chars: CharState[] = [];
    const colCount = Math.floor(containerWidth / CHAR_W);
    let col = 0; let row = 0;

    for (const ch of text) {
      if (ch === '\n') { col = 0; row++; continue; }
      if (col >= colCount) { col = 0; row++; }
      const targetX = col * CHAR_W;
      const targetY = row * LINE_H;
      const startY = mode === 'bounce-in' ? targetY - 30 : targetY;
      chars.push({
        char: ch,
        x: targetX, y: startY,
        targetX, targetY,
        vx: 0,
        vy: mode === 'bounce-in' ? 0 : mode === 'rise' ? -20 : 0,
        opacity: 1,
        phase: chars.length * 0.3,
        resolvedChar: ch,
        glitchTimer: 0,
        angle: mode === 'orbit' ? (chars.length / Math.max(text.length, 1)) * Math.PI * 2 : 0,
        orbitR: mode === 'orbit' ? 30 : undefined,
        orbitCX: mode === 'orbit' ? containerWidth / 2 : undefined,
        orbitCY: mode === 'orbit' ? containerHeight / 2 : undefined,
      });
      col++;
    }

    return chars;
  }

  /** Advance physics by dt seconds. Returns new char states (immutable). */
  tick(chars: CharState[], dt: number, mode: EffectMode, params: TickParams = {}): CharState[] {
    const t = params.time ?? performance.now() / 1000;
    const amp = params.amplitude ?? 4;
    const period = params.period ?? 2;
    const orbitSpeed = params.orbitSpeed ?? 1.0;

    return chars.map((c): CharState => {
      switch (mode) {
        case 'wave': {
          return { ...c, x: c.targetX, y: c.targetY + amp * Math.sin(t * (2 * Math.PI / period) + (c.phase ?? 0)) };
        }
        case 'gravity': {
          const vy = c.vy + 280 * dt;
          const y = c.y + vy * dt;
          const opacity = Math.max(0, c.opacity - dt * 0.8);
          return { ...c, vy, y, opacity };
        }
        case 'bounce-in': {
          const distY = c.targetY - c.y;
          const spring = distY * 120;
          const vy = (c.vy + spring * dt) * 0.85;
          const y = c.y + vy * dt;
          return { ...c, vy, y };
        }
        case 'rise': {
          const y = c.y - 40 * dt;
          const opacity = Math.max(0, c.opacity - dt * 1.2);
          return { ...c, y, opacity };
        }
        case 'scatter': {
          const phase = params.scatterPhase ?? 'flying';
          if (phase === 'flying') {
            const vx = c.vx * 0.85;
            const vy = c.vy * 0.85;
            return { ...c, vx, vy, x: c.x + vx * dt * 60, y: c.y + vy * dt * 60 };
          }
          // returning phase
          const dx = c.targetX - c.x;
          const dy = c.targetY - c.y;
          return { ...c, x: c.x + dx * 6 * dt, y: c.y + dy * 6 * dt };
        }
        case 'orbit': {
          if (c.orbitR == null || c.orbitCX == null || c.orbitCY == null) return c;
          const angle = (c.angle ?? 0) + orbitSpeed * dt;
          const x = c.orbitCX + c.orbitR * Math.cos(angle);
          const y = c.orbitCY + c.orbitR * Math.sin(angle);
          return { ...c, angle, x, y };
        }
        case 'magnetic': {
          if (params.cursorX == null || params.cursorY == null) return c;
          const dx = params.cursorX - c.x;
          const dy = params.cursorY - c.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > 40 * 40) return c; // outside radius
          const strength = 800 / Math.max(dist2, 1);
          return { ...c, x: c.x + dx * strength * dt, y: c.y + dy * strength * dt };
        }
        case 'glitch': {
          const intensity = params.glitchIntensity ?? 0.3;
          if (Math.random() < intensity) {
            const noiseChar = NOISE_GLYPHS[Math.floor(Math.random() * NOISE_GLYPHS.length)];
            return { ...c, char: noiseChar, glitchTimer: 3 };
          }
          if ((c.glitchTimer ?? 0) > 0) {
            return { ...c, glitchTimer: (c.glitchTimer ?? 0) - 1 };
          }
          return { ...c, char: c.resolvedChar ?? c.char };
        }
        case 'vortex': {
          const cx = params.sweepX ?? 100;
          const cy = params.sweepY ?? 50;
          const dx = cx - c.x;
          const dy = cy - c.y;
          return { ...c, x: c.x + dx * 3 * dt, y: c.y + dy * 3 * dt, opacity: Math.max(0, c.opacity - dt * 0.5) };
        }
        case 'parting-water': {
          const sweepY = params.sweepY ?? 0;
          const dist = Math.abs(c.targetY - sweepY);
          if (dist > LINE_H * 2) return c;
          const pushX = c.targetX < (params.sweepX ?? 100) ? -20 * dt : 20 * dt;
          const returnX = (c.targetX - c.x) * 4 * dt;
          return { ...c, x: c.x + pushX + returnX };
        }
        case 'dragon': {
          const sweepX = params.sweepX ?? 0;
          const dist = Math.abs(c.x - sweepX);
          if (dist > 60) return c;
          const pushY = -80 / Math.max(dist, 8);
          return { ...c, y: c.y + pushY * dt * 60, x: c.x + (c.x < sweepX ? -20 : 20) * dt };
        }
        case 'flow':
        default:
          return c;
      }
    });
  }

  /** True when all chars are within 1px of their target position, or all have faded out. */
  isSettled(chars: CharState[]): boolean {
    if (chars.length === 0) return true;
    // For fade-out effects (gravity, rise, vortex), settled = all chars invisible
    const allFaded = chars.every(c => c.opacity <= 0.01);
    if (allFaded) return true;
    // For position-based effects, settled = all within 1px of target
    return chars.every(c =>
      Math.abs(c.x - c.targetX) < 1 &&
      Math.abs(c.y - c.targetY) < 1
    );
  }

  /** Accept externally-positioned chars (from PretextCompositor), apply one tick of effects, return updated positions. */
  tickChars(
    chars: PositionedCharInput[],
    dt: number,
    mode: EffectMode,
    params: TickParams = {}
  ): PositionedCharInput[] {
    const internal: CharState[] = chars.map(c => ({
      char: c.char, x: c.x, y: c.y,
      targetX: c.x, targetY: c.y,
      vx: c.effectState?.vx ?? 0,
      vy: c.effectState?.vy ?? 0,
      opacity: c.opacity,
      phase: c.effectState?.phase ?? Math.random() * Math.PI * 2,
      angle: c.effectState?.angle ?? 0,
      orbitR: c.effectState?.orbitR,
      orbitCX: c.effectState?.orbitCX,
      orbitCY: c.effectState?.orbitCY,
      glitchTimer: c.effectState?.glitchTimer ?? 0,
      resolvedChar: c.effectState?.resolvedChar ?? c.char,
    }));

    const ticked = this.tick(internal, dt, mode, params);

    return ticked.map((t, i) => ({
      char: t.char, x: t.x, y: t.y,
      font: chars[i].font, color: chars[i].color,
      opacity: t.opacity, zIndex: chars[i].zIndex,
      elementId: chars[i].elementId,
      effectState: t,
    }));
  }

  checkRateLimit(mode: EffectMode, panelId: string): boolean {
    const limit = RATE_LIMITS[mode];
    if (limit === undefined) return true; // unrestricted
    if (limit === 'session') return !this.dragonFired;
    const key = `${mode}:${panelId}`;
    const last = this.usageLog.get(key) ?? 0;
    return Date.now() - last >= limit;
  }

  recordUsage(mode: EffectMode, panelId: string): void {
    if (mode === 'dragon') { this.dragonFired = true; return; }
    const key = `${mode}:${panelId}`;
    this.usageLog.set(key, Date.now());
  }
}
