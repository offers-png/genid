# GENID security fixes — October 2, 2026

Implemented locally against main commit 1e305ad (PR #17). Not pushed or deployed.

## Before / after

| Check | Before | After |
| --- | --- | --- |
| Production npm audit package findings | 7: 1 critical, 4 high, 2 moderate | 0 |
| Automated tests | 117 passing / 22 files | 135 passing / 26 files |
| Production build | Passing | Passing, including TypeScript |
| Next.js | 16.2.4 | 16.3.8 |
| Sharp | 0.34.5 | 0.35.5 |

Compatible transitive updates were also applied with npm audit fix; eslint-config-next was aligned with Next. Sharp 0.35 required a named Metadata type import. The lockfile records the complete resolved dependency set.

## Changes

1. Dependencies: patched Next/Sharp and compatible transitive dependencies. No npm audit force or ignored advisories.
2. Atomic quotas: migration 016 creates a service-role-only RPC and RLS-protected quota table. A row lock serializes each identity/budget reservation. Generation and regeneration share 10 attempts per rolling five minutes; stamping has 20. Reservations happen before paid work and are retained after failures/timeouts to avoid ambiguous costs being retried for free. Expired timestamps are pruned on reservation; at most 10/20 timestamps are retained per row. Database errors or invalid RPC results block the operation (500), while exhausted budgets return 429. No fail-open count remains on these three routes.
3. Uploads: embed authenticates before reading multipart data. Both routes read through a bounded reader before parsing (15 MiB plus 64 KiB multipart overhead), cancel on overflow and return 413. Actual bytes enforce the cap even without a Content-Length header or with a false value. File.size is checked before arrayBuffer/Buffer conversion. Malformed, empty or oversized individual files return 400.
4. Headers: common CSP fallback, DENY framing, nosniff, strict-origin-when-cross-origin and one-year HSTS are configured in next.config.ts. Page responses receive unpredictable request-specific script nonces from proxy.ts. Production scripts do not allow unsafe-inline/unsafe-eval; inline styles remain allowed for React image previews/components. Root pages render dynamically and HTML is not publicly cached, which is necessary for per-request nonces and changes the previous static-page caching behavior. HTTPS remains enforced by Render; HSTS applies when served over HTTPS.

## Verification performed

- npm audit --omit=dev --json: zero findings.
- npm test: 135/135 across 26 files.
- npm run build: passed after fixing the Sharp type import.
- Targeted ESLint checks on changed application code and new test files: passed.
- git diff --check: passed.
- Migration 016 executed in embedded PostgreSQL (PGlite): quota exhaustion, expiry, identity/budget separation, role restrictions, failure handling. Two concurrently invoked stamping route requests with one slot left produce one 200 and one 429; only one blockchain invocation occurs.
- PGlite serializes queries through one connection. These tests execute the actual migration and route/RPC code but do not reproduce contention between two independent PostgreSQL connections. Repeat that check on staging Supabase.
- Real Sharp PNG and JPEG upload -> stamp -> exact-byte verification passed; PNG output dimensions/format remained correct. Auth, database/storage and blockchain are simulated in those route tests; image transformation, hashes, signatures and extraction are real.
- Local production HTTP checks: seven pages return 200, all requested headers present, script nonces match response policy and vary between requests. Valid unstamped PNG returns 200, corrupt data 400, oversized request 413, anonymous malformed embed 401. A chunked oversized HTTP upload without Content-Length also returned 413.
- Browser: home -> verify navigation, file chooser, image preview, verification result, create-session sign-in gate and login navigation all worked. No browser console warning/error was captured during this flow.

## Deployment / Supabase handoff

Apply supabase/migrations/016_atomic_paid_quotas.sql **before deploying the updated application**. Missing RPC/schema intentionally blocks paid work. Existing migrations 001–015 remain prerequisites. The new quota table starts empty; completed operations before migration are not backfilled, so the first deployment starts a fresh quota budget.

Check service_role can reserve while anon/authenticated cannot execute the RPC or read/write the quota table. On a staging identity, leave one reservation available and send two concurrent generation/regeneration requests from separate clients: only one should call the provider. Verify the separate stamping budget likewise. Do not reset production quota rows as a routine workaround.

Local preview: http://127.0.0.1:3011. Full authenticated production calls to Stripe, OpenAI, Supabase and Polygon were not repeated; local service credentials are absent. StackHawk remains a separate live scan pending account/application setup. This is a documented set of fixes and checks, not a security certification or a claim of 10/10 security.

Evidence files in the parent workspace: genid-dependency-audit.json (before), genid-audit-after.json, genid-local-security-checks.json, genid-security-ui.jpg.
