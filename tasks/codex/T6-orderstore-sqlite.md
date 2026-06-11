# T6 — OrderStore Persistence (SQLite behind the existing injectable interface)

**Branch:** `feat/orderstore-sqlite` · **Worktree:** `~/devbox/storybook-workshop-codex-t6`
**Protocol:** read `README-protocol.md` (same directory / `~/codex-tasks/`) for environment,
worktree setup, commit rules, PR sequence. Repo `~/devbox/storybook-workshop` on claude.local —
SvelteKit + TS strict + Vitest 4, `$lib` = `src/lib`, Node 22
(`source ~/.nvm/nvm.sh && nvm use 22`), pnpm. Baseline ~1097 tests green — keep them green.
**WORKTREE EXCEPTION:** do NOT symlink `node_modules` for this task — run a real
`pnpm install` in the worktree, because you add a native dependency that must build there.

## 1. Objective

Production orders currently live in an in-memory `Map` — a server restart deletes every paid
order. Implement `SqliteOrderStore` (and `SqliteQualityClaimStore`) on `better-sqlite3` behind
the EXISTING `OrderStore` / `QualityClaimStore` interfaces, with schema migration v1, WAL mode,
transactional writes, `ORDER_DB_PATH` env config, graceful in-memory fallback when
better-sqlite3 is unavailable, and default-deps wiring so Node production gets SQLite while
vitest/browser keep the in-memory store. `InMemoryOrderStore` remains the default for tests.

## 2. Why it matters

This is real-money state: `Order` rows back Stripe payment intents, Lulu print jobs, refunds,
and quality claims. The audit chain (`OrderAuditService`, `pdfHash` Stripe-dispute defense)
is worthless if the underlying store evaporates on deploy. SQLite + WAL on local disk is the
smallest durable step that fits the current single-node deployment, and the injectable
interface means zero churn for every existing consumer and test.

## 3. Repo context — real paths (READ ALL of these before coding)

- `src/lib/services/fulfillment/types.ts` — `OrderStore` interface (~line 261):
  ```ts
  export interface OrderStore {
    get(id: string): Promise<Order | undefined>;
    put(order: Order): Promise<void>;
    listByParent(email: string): Promise<Order[]>;
    getByStripePaymentIntent(id: string): Promise<Order | undefined>;
    getByLuluJob(id: string): Promise<Order | undefined>;
  }
  export interface QualityClaimStore {
    get(id: string): Promise<QualityClaim | undefined>;
    put(claim: QualityClaim): Promise<void>;
    listPending(): Promise<QualityClaim[]>;
  }
  ```
  Read the full `Order`, `OrderState`, `TransitionLogEntry`, `QualityClaim` shapes in the same
  file — the transitions table maps the order's embedded transition log (verify the exact
  field name there; `OrderAuditService.ts` imports `TransitionLogEntry`).
- `src/lib/services/fulfillment/OrderLifecycleService.ts` — `InMemoryOrderStore` (~line 286)
  implements `OrderStore`; the lifecycle service performs state transitions then `put`s.
- `src/routes/api/order/+server.ts` — `OrderApiDeps { lifecycle, stripe,
  store: InMemoryOrderStore, idGen, nowSource }` with `__setOrderApiDeps` /
  `__getOrderApiDeps()` (lazy default wiring). NOTE the field is typed as the CONCRETE
  `InMemoryOrderStore` — you widen it to `OrderStore` (§4d). Consumers of
  `__getOrderApiDeps`: `src/routes/api/stripe-webhook/+server.ts`,
  `src/routes/api/lulu-webhook/+server.ts`, `src/routes/api/order/[id]/+server.ts`,
  `src/routes/api/quality-claim/+server.ts` — grep them for any InMemory-specific member
  access before widening.
- `src/lib/services/fulfillment/index.ts` — barrel; export the new store + factory from here.
- Existing fulfillment tests: `tests/fulfillment/` (16 files incl. `api-order-endpoint.test.ts`,
  `order-lifecycle.test.ts`, `fixtures.ts`, `api-helpers.ts` — reuse their Order fixtures).

## 4. Detailed scope — file-by-file

### 4a. `src/lib/services/fulfillment/SqliteOrderStore.ts`

`better-sqlite3` is synchronous — load it via `createRequire(import.meta.url)` inside a
try/catch so the module stays importable where the native lib is absent (browser bundle,
toolchain-less box). Public surface:

```ts
export function sqliteAvailable(): boolean;
export interface SqliteStoreOptions { dbPath?: string;       // default: env ORDER_DB_PATH ?? './data/orders.db'
  env?: Record<string, string | undefined> }                  // injectable for tests (default process.env)
export function createSqliteStores(opts?: SqliteStoreOptions): {
  orderStore: OrderStore; qualityClaimStore: QualityClaimStore; close(): void; dbPath: string } | null;
  // returns null (with ONE console.warn naming the reason) when better-sqlite3 can't load
```

Behavior:
- **Dir auto-create**: `mkdirSync(dirname(dbPath), { recursive: true })` before open.
- **Pragmas**: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- **Schema migration v1** — `schema_meta(key, value)` holds `version`; on open, version absent
  → run v1 DDL inside one transaction, set version `1`; version `1` → no-op; version > 1 →
  throw (refuse to downgrade-write). DDL v1:

| table | columns |
|---|---|
| `orders` | `id TEXT PK`, `state TEXT NOT NULL`, `parent_email TEXT NOT NULL`, `stripe_payment_intent_id TEXT`, `lulu_job_id TEXT`, `json TEXT NOT NULL` (full serialized Order — source of truth), `updated_at INTEGER NOT NULL`; indexes on `parent_email`, `stripe_payment_intent_id`, `lulu_job_id` |
| `transitions` | `order_id TEXT NOT NULL`, `seq INTEGER NOT NULL`, `from_state TEXT`, `to_state TEXT NOT NULL`, `at INTEGER NOT NULL`, `json TEXT NOT NULL`, `PRIMARY KEY (order_id, seq)` |
| `quality_claims` | `id TEXT PK`, `order_id TEXT`, `status TEXT NOT NULL`, `json TEXT NOT NULL`, `updated_at INTEGER NOT NULL`; index on `status` |

- **`put(order)` is one `db.transaction`**: upsert the `orders` row (lookup columns extracted
  from the Order object — match exact field names from `types.ts`) + delete-and-reinsert that
  order's `transitions` rows from the embedded transition log. Any failure → whole write rolls
  back (atomicity test in §5). All statements parameterized (`?` bindings) — string
  interpolation into SQL is an automatic review kickback.
- **Reads** deserialize the `json` column (the row columns are lookup-only); `get` on a miss →
  `undefined` (NOT null — match the interface).
- Interface methods stay `async` (wrap sync calls; no fake delays).

### 4b. Default store selection — `src/lib/services/fulfillment/storeFactory.ts`

```ts
export type StoreRuntime = 'node-prod' | 'vitest' | 'browser';
export function detectStoreRuntime(env = process-env-safe): StoreRuntime;  // VITEST/TEST env or import.meta.env.TEST → 'vitest'; no process/window present → 'browser'
export function createDefaultFulfillmentStores(opts?): { orderStore; qualityClaimStore; kind: 'sqlite' | 'memory' }
```
'node-prod' → try `createSqliteStores`; null → in-memory + `console.warn`
(`[fulfillment] better-sqlite3 unavailable — orders are NOT durable`). 'vitest'/'browser' →
in-memory, silent. Every branch observable via the returned `kind`.

### 4c. Quality-claim store
`SqliteQualityClaimStore` ships in the same module/transaction style. Check how
`src/routes/api/quality-claim/+server.ts` + `QualityGuaranteeHandler.ts` source their claim
store today; if an injectable seam exists, wire the default through `storeFactory`; if claims
are currently constructed ad-hoc, add the sqlite store + factory output and wire ONLY where a
seam already exists (no new seams in handlers — note what you found in the PR body).

### 4d. Wiring — `src/routes/api/order/+server.ts`
- Widen `OrderApiDeps.store: InMemoryOrderStore` → `OrderStore` (fix any consumer fallout
  found in §3 grep).
- In `__getOrderApiDeps()` default path, replace `new InMemoryOrderStore()` with
  `createDefaultFulfillmentStores()` — under vitest this returns in-memory, so the existing
  16-file `tests/fulfillment/` suite behavior is unchanged (prove by running it).
- `__setOrderApiDeps` injection seam unchanged.

### 4e. `package.json`
Add `better-sqlite3` under **`optionalDependencies`** (pin a major, e.g. `^12`), plus
`@types/better-sqlite3` in devDependencies. Commit the lockfile change from a real
`pnpm install` run.

## 5. Test plan — `tests/fulfillment/sqlite-order-store.test.ts` + `store-factory.test.ts` (~15)

Use `fs.mkdtempSync(os.tmpdir() + ...)` per test; reuse Order fixtures from
`tests/fulfillment/fixtures.ts`. Guard: `const available = sqliteAvailable()` — sqlite-backed
tests run under `(available ? describe : describe.skip)` BUT the Done criteria requires the
run on claude.local to show **0 skipped** in these files (native build present after
`pnpm install`).

1. put → get roundtrip: deserialized Order deep-equals the fixture (nested objects intact).
2. get unknown id → `undefined`.
3. put twice (state changed) → single row, latest state, updated_at bumped.
4. listByParent → only that email's orders; other emails excluded.
5. getByStripePaymentIntent finds the right order.
6. getByLuluJob finds the right order.
7. Transitions persisted: row count in `transitions` equals the order's transition-log length;
   re-put after a new transition appends correctly (delete-and-reinsert verified).
8. **Atomicity**: craft a put that fails mid-transaction (e.g. doctored transition log with a
   duplicate seq violating the PK) → put rejects AND the previously stored order + transitions
   are unchanged (read back and compare).
9. **Restart persistence**: put → `close()` → new `createSqliteStores` on the SAME path →
   `get` returns the order.
10. WAL active: `journal_mode` pragma reads back `wal`.
11. Dir auto-create: dbPath with two non-existent nested dirs opens fine.
12. `ORDER_DB_PATH` honored via injected `env` (no real process.env mutation).
13. Quality claims: put/get + `listPending` returns only pending-status claims.
14. Fallback: factory with a forced-unavailable seam (inject/spyOn loader) → `kind: 'memory'`
    + `console.warn` called once (spy) — warn message asserted.
15. Runtime detection: under vitest → 'vitest' (and `createDefaultFulfillmentStores().kind ===
    'memory'`); injected fake env without VITEST + process present → 'node-prod'.

Plus: the EXISTING `tests/fulfillment/` suite (16 files) must pass unmodified — that is the
real regression gate for §4d.

## 6. Verification commands

```bash
cd ~/devbox/storybook-workshop-codex-t6
source ~/.nvm/nvm.sh && nvm use 22 && pnpm install   # builds better-sqlite3
pnpm check && pnpm lint
npx vitest run tests/fulfillment/                     # old 16 files + new 2, 0 skipped in new files
pnpm test                                             # full suite green
node -e "const {createSqliteStores}=await import('./src/lib/services/fulfillment/SqliteOrderStore.ts').catch(()=>({})); console.log('ts-direct import not expected to work — smoke via vitest only')"
```
(Primary evidence is the vitest run; paste its summary in the PR body.)

## 7. Done criteria

- [ ] `SqliteOrderStore.ts` + `storeFactory.ts` per §4, exported from the fulfillment barrel.
- [ ] `OrderApiDeps.store` widened to `OrderStore`; all 5 API consumer files compile + their
      tests pass untouched.
- [ ] ≥ 15 new tests green with **0 skips on claude.local**; full suite ≥ baseline + 15;
      check + lint clean.
- [ ] All SQL parameterized; zero string-built SQL (grep `db.prepare` usages in review).
- [ ] `better-sqlite3` in optionalDependencies only; app still boots (vitest proves import
      safety) when it is absent.
- [ ] Branch pushed; PR opened with `king:review` label; PR body includes the vitest summary
      line and what you found re: quality-claim seam (§4c).

## 8. Out of scope — do NOT

- Do NOT introduce an ORM, drizzle, knex, or a second new dependency.
- Do NOT change `OrderStore`/`QualityClaimStore` interface signatures or `InMemoryOrderStore`
  behavior — additive implementations only.
- Do NOT migrate subscription/gift/referral stores (different subsystem, different task).
- Do NOT add connection pooling, server clustering, or a DB server — better-sqlite3 single
  file is the design.
- Do NOT write any order data outside `ORDER_DB_PATH`'s directory; never commit a `.db` file
  (add `data/` to `.gitignore` if not already ignored).
