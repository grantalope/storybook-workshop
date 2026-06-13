#!/usr/bin/env node
// scripts/validation/probes/state-machine-integrity.mjs
// Probe: state-machine-integrity
// Validates order/subscription FSM for unreachable states, absorbing non-terminal states,
// and states missing outbound transitions.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

/** Known valid terminal states (empty outbound transitions are OK for these) */
const VALID_TERMINALS = new Set([
  'delivered',
  'cancelled_pre_production',
  'failed_validation',
  'lulu_error_terminal',
  'lost_in_transit',
]);

const INITIAL_STATE = 'pending_payment';

/**
 * Parse ALLOWED transitions map from OrderLifecycleService.ts
 * Returns Map<state, Set<state>> or null if parsing fails
 */
function parseAllowedMap(src) {
  // Find the ALLOWED const block
  const allowedMatch = src.match(/const ALLOWED[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\s*\)/);
  if (!allowedMatch) return null;

  const block = allowedMatch[1];
  const map = new Map();

  // Parse each state entry: stateName: new Set<OrderState>(['...', '...'])
  const entryPattern = /(\w+)\s*:\s*new Set<[^>]*>\s*\(\[([\s\S]*?)\]\)/g;
  let m;
  while ((m = entryPattern.exec(block)) !== null) {
    const state = m[1];
    const transitions = m[2].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    map.set(state, new Set(transitions));
  }

  return map.size > 0 ? map : null;
}

/**
 * Parse OrderState type from types.ts
 * Returns Set<string> of all declared states
 */
function parseOrderStates(src) {
  const states = new Set();
  // Pattern: | 'stateName'
  const statePattern = /\|\s*'([^']+)'/g;
  let m;
  // Find the OrderState type
  const typeMatch = src.match(/export type OrderState\s*=\s*([\s\S]*?);/);
  if (!typeMatch) return states;
  const typeBlock = typeMatch[1];
  while ((m = statePattern.exec(typeBlock)) !== null) {
    states.add(m[1]);
  }
  return states;
}

/**
 * BFS from initial state to find all reachable states
 */
function findReachable(allowedMap, initial) {
  const reachable = new Set([initial]);
  const queue = [initial];
  while (queue.length > 0) {
    const current = queue.shift();
    const transitions = allowedMap.get(current) || new Set();
    for (const next of transitions) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  const lifecycleFile = join(rootDir, 'src/lib/services/fulfillment/OrderLifecycleService.ts');
  const typesFile = join(rootDir, 'src/lib/services/fulfillment/types.ts');

  if (!existsSync(lifecycleFile)) {
    return [{
      id: 'state-machine-integrity-missing-lifecycle',
      file: 'src/lib/services/fulfillment/OrderLifecycleService.ts',
      line: null,
      severity: 'P1',
      logicGap: 'OrderLifecycleService.ts not found — cannot validate state machine',
      evidence: 'File does not exist at expected path',
      suggestedFix: 'Ensure OrderLifecycleService.ts exists at src/lib/services/fulfillment/',
      workerHint: 'Create OrderLifecycleService.ts with ALLOWED transitions map',
      suggestedLane: 'sonnet-review',
      confidence: 1.0
    }];
  }

  const lifecycleSrc = readFileSync(lifecycleFile, 'utf8');
  const typesSrc = existsSync(typesFile) ? readFileSync(typesFile, 'utf8') : '';

  const allowedMap = parseAllowedMap(lifecycleSrc);
  if (!allowedMap) {
    findings.push({
      id: 'state-machine-integrity-parse-failed',
      file: 'src/lib/services/fulfillment/OrderLifecycleService.ts',
      line: null,
      severity: 'P1',
      logicGap: 'Could not parse ALLOWED transitions map from OrderLifecycleService.ts',
      evidence: 'Regex parsing of ALLOWED const failed — structure may have changed',
      suggestedFix: 'Verify ALLOWED map follows pattern: const ALLOWED = Object.freeze({ stateName: new Set<OrderState>([...]) })',
      workerHint: 'Check that ALLOWED const in OrderLifecycleService.ts uses Object.freeze({ state: new Set<OrderState>([...]) }) pattern',
      suggestedLane: 'sonnet-review',
      confidence: 0.9
    });
    return findings;
  }

  const declaredStates = parseOrderStates(typesSrc);
  const allStatesInMap = new Set(allowedMap.keys());

  // Add any states referenced as transitions (may not be keys if they have no outbound)
  for (const [, transitions] of allowedMap) {
    for (const t of transitions) allStatesInMap.add(t);
  }

  const reachable = findReachable(allowedMap, INITIAL_STATE);

  // Check 1: Unreachable states (in map but not reachable from initial state)
  for (const state of allStatesInMap) {
    if (!reachable.has(state)) {
      findings.push({
        id: `state-machine-integrity-unreachable-${state}`,
        file: 'src/lib/services/fulfillment/OrderLifecycleService.ts',
        line: null,
        severity: 'P1',
        logicGap: `State '${state}' is defined in ALLOWED map but unreachable from initial state '${INITIAL_STATE}'`,
        evidence: `BFS from '${INITIAL_STATE}' does not reach '${state}'`,
        suggestedFix: `Either remove '${state}' from ALLOWED map or add a transition path from an existing reachable state`,
        workerHint: `In OrderLifecycleService.ts: add a transition to '${state}' from a reachable state, or remove it if it's dead code`,
        suggestedLane: 'sonnet-review',
        confidence: 0.95
      });
    }
  }

  // Check 2: Absorbing non-terminal states (in map as key with empty transitions, NOT a valid terminal)
  for (const [state, transitions] of allowedMap) {
    if (transitions.size === 0 && !VALID_TERMINALS.has(state)) {
      findings.push({
        id: `state-machine-integrity-absorbing-${state}`,
        file: 'src/lib/services/fulfillment/OrderLifecycleService.ts',
        line: null,
        severity: 'P0',
        logicGap: `State '${state}' has no outbound transitions and is not a valid terminal state — orders entering this state are trapped`,
        evidence: `ALLOWED['${state}'] = new Set([]) but '${state}' is not in VALID_TERMINALS list`,
        suggestedFix: `Either add outbound transitions from '${state}', or add it to the VALID_TERMINALS documentation`,
        workerHint: `In OrderLifecycleService.ts: add transitions from '${state}' or document it as a valid terminal state`,
        suggestedLane: 'sonnet-review',
        confidence: 0.9
      });
    }
  }

  // Check 3: States declared in types.ts but missing from ALLOWED map
  for (const state of declaredStates) {
    if (!allowedMap.has(state)) {
      findings.push({
        id: `state-machine-integrity-missing-in-map-${state}`,
        file: 'src/lib/services/fulfillment/OrderLifecycleService.ts',
        line: null,
        severity: 'P1',
        logicGap: `OrderState '${state}' is declared in types.ts but has no entry in ALLOWED transitions map`,
        evidence: `'${state}' found in OrderState type but not as a key in ALLOWED`,
        suggestedFix: `Add '${state}': new Set<OrderState>([...]) to the ALLOWED map in OrderLifecycleService.ts`,
        workerHint: `In OrderLifecycleService.ts: add entry for '${state}' in ALLOWED map with its valid outbound transitions`,
        suggestedLane: 'free-cloud',
        confidence: 0.85
      });
    }
  }

  return findings;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const rootDir = process.argv[2] || process.cwd();
  run(rootDir).then(findings => {
    if (findings.length === 0) {
      console.log('PASS: state-machine-integrity — no issues found');
    } else {
      console.log(`FAIL: state-machine-integrity — ${findings.length} finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
      }
    }
    process.exit(findings.some(f => f.severity === 'P0' || f.severity === 'P1') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
