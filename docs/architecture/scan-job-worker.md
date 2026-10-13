# Minimal Postgres scan-job + Render worker

Status: **design only** (Harry stability fix #4). Not built in this PR.

## Problem

`POST /api/scan` runs `scanArea(...)` synchronously on the same Render **starter** web instance that serves Today / Find / Map / Opportunities (`maxDuration` 120). One scan can make the sole instance unresponsive → edge **502** / restart → whole product offline.

## Durable shape (MVP, no Redis)

```
┌──────────────────────────┐     ┌─────────────────────────────┐
│  Render WEB (starter+)   │     │  Render WORKER (background) │
│  Next.js UI + light APIs │     │  node scripts/scan-worker   │
│                          │     │                             │
│  POST /api/scan-jobs     │────▶│  poll ScanJob QUEUED        │
│   → insert ScanJob       │     │  run scanArea(...)          │
│   → return { id } ASAP   │     │  update status + result JSON│
│                          │     │                             │
│  GET /api/scan-jobs/:id  │◀────│  Postgres ScanJob row       │
│  Map polls until done    │     └─────────────────────────────┘
└──────────────────────────┘                    ▲
                 │                              │
                 └─────────── Postgres ─────────┘
```

## Schema (sketch)

```prisma
model ScanJob {
  id          String   @id @default(cuid())
  status      String   // QUEUED | SCANNING_PARCELS | CHECKING_PLANNING | BUILDING_ASSEMBLIES | RUNNING_FEASIBILITY | COMPLETE | FAILED
  stageLabel  String?
  progress    Json?    // string[] stage labels
  request     Json     // bbox | suburbHint | centreQuery | maxResults
  result      Json?    // scanArea payload when COMPLETE
  error       String?
  createdAt   DateTime @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?
  updatedAt   DateTime @updatedAt

  @@index([status, createdAt])
}
```

## API

| Method | Path | Behaviour |
|--------|------|-----------|
| `POST` | `/api/scan-jobs` | Validate body → insert `QUEUED` → `{ id, status }` (no `scanArea`) |
| `GET` | `/api/scan-jobs/:id` | Return status / stage / result / error for UI poll (~1–2s) |

**Retired path:** synchronous `POST /api/scan` stays gated (`LIVE_DEEP_SCAN_ENABLED`) until worker is live; then either remove it or make it enqueue-only.

## Worker

- Render **Background Worker** (same repo, same `DATABASE_URL`).
- Loop: `SELECT … FOR UPDATE SKIP LOCKED` where `status = 'QUEUED'` → claim → run `scanArea` → write `result` / `FAILED`.
- Update `status` between major stages so the Map progress copy matches current labels.
- Concurrency: **1** job at a time on starter-class worker is enough for MVP.
- Idle sleep 2–5s when queue empty.

## UI

1. User clicks Scan (once re-enabled against jobs API).
2. Map creates job, keeps session id, polls `GET /api/scan-jobs/:id`.
3. On `COMPLETE`, consume `result` exactly as today's `/api/scan` JSON (`candidates`, `valuedParcels`, …).
4. On `FAILED`, show error without taking down the web process.

## Short-term mitigation (not durable)

Upgrading the existing web plan (more RAM/CPU) may reduce restart frequency but **does not** isolate scan from user traffic. Prefer the worker; plan bump is optional while building it.

## Temporary protection (this PR)

- UI: "Live deep scan temporarily unavailable"
- API: `POST /api/scan` → 503 unless `LIVE_DEEP_SCAN_ENABLED=true`
- Indexed Today / Find / INDEX_CANDIDATE Map remain the supported path
