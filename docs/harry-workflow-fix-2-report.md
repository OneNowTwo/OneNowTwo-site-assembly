# Harry workflow fix #2 — Map stale state, production 502, Today language

**Branch:** `cursor/harry-map-502-today-708b`  
**Repo:** OneNowTwo/OneNowTwo-site-assembly  
**Do not merge automatically.**

---

## 1. Map stale scan state — root cause & fix

**Cause:** `MapWorkspace` initialises `scan` from `loadScanSession()` on mount. The `mapTarget` effect (Today → `/map?parcelId=…`) flew to the new site but never cleared restored candidates/families/bbox overlays, so Parramatta (or any prior scan) stayed visible on the map and in the sidebar.

**Fix:**

- `shouldRestoreScanSession()` — skip restoring localStorage scan when the URL is an explicit entity target (`PARCEL`, `OPPORTUNITY`, `PLANNING_AREA`, `KEY_SITE`, `DEVELOPMENT_ACTIVITY`).
- On those targets, `dismissStaleScanDisplay()` clears in-memory scan UI **without** `clearScanSession()` (saved work remains on disk until the user clears or runs a new scan).
- `primeExplicitTargetParcels()` + `EXPLICIT_TARGET_VIEWPORT_PARCEL_SUPPRESS_MS` — one tight `/api/parcels` fetch from candidate bbox/centroid; suppress viewport-wide parcel loads for 12s (same class of protection as post-scan cooldown).
- `resolveMapTarget` now attaches `bbox` on `PARCEL` targets (indexed candidates ship bbox in the href).

**Tests:** `tests/map-entity-target-scan.test.ts` (213 tests pass).

---

## 2. Production 502 — Render log evidence (Request ID `a49a62d9fb890fc3-SIN`)

**User time:** ~2026-10-13 12:34 AEDT → **2026-10-13 01:34 UTC** (Singapore edge `-SIN` matches Render region).

**What was checked:** Render CLI `render logs -r srv-davggsou01pc73eme5s0` with text/status/time filters; service `site-assembly` (Singapore), DB `dpg-davgg1lg1s2s73ae3jc0-a`.

| Finding | Evidence |
|--------|----------|
| **Request ID not in app logs** | `--text a49a62d9` → **0 lines**. HTTP request IDs (Cloudflare/Render edge) are not present in stdout logs available via CLI. |
| **Empty window around incident** | `--start 2026-10-13T01:25:00Z --end 2026-10-13T01:45:00Z` → **0 lines** (retention/filtering; no per-request 502 line to tie to Bexley click). |
| **Deploy restarts earlier same day** | `2026-10-13 00:53:42` and `00:57:13 UTC` — `Instance srv-davggsou01pc73eme5s0-hl8cz restarted` during/after deploy of merge `73c718c` (Harry Find #1). Startup: `next start`, Prisma migrate, bootstrap OK. |
| **Historical OOM pattern (not same minute as user report)** | `2026-10-11` multiple `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` followed by instance restarts — starter-plan Node process killed under load. |

**What we cannot claim from logs:** That a specific `/map`, `/api/parcels`, `/api/scan`, or proposed-planning call failed for request `a49a62d9fb890fc3-SIN`. The 502 Bad Gateway + `-SIN` is consistent with **origin unavailable or timing out** (restart window, heap crash history, or heavy concurrent work), not with a client-side navigation mistake.

**Code-path review (Today → Map):** Indexed candidates use `buildMapHref({ lat, lng, zoom: 18, parcelId, bbox, opportunityId? })`. `resolveMapTarget` prefers `OPPORTUNITY` when `opportunityId` is set; otherwise `PARCEL`. **No `/api/scan`** on that path. Risk was **viewport `/api/parcels` at zoom 18** plus optional **`/api/planning/proposed-areas`** if layers toggled — mitigated on this branch by explicit-target bbox fetch + 12s viewport suppress.

**Sydney index batches:** **None run** during this fix pass.

---

## 3. Today copy changes

| Before | After |
|--------|--------|
| Top intelligence | What changed |
| Sites to look at today | Sites worth a look |
| Why this surfaced today | Why it stands out |
| No material Greater Sydney intelligence… | No important planning or development changes picked up this week. |
| Loading development intelligence… | Loading Today… |
| Development Intelligence (headline) | This morning |
| indexed sites / Material planning… (story fallback) | sites in scope / Notable planning… |
| related signals | related updates |
| Sydney-index candidates… | No ranked Sydney sites… |
| index preparing message | Sydney site list is still filling in… |

Files: `src/components/monitoring/dashboard-client.tsx`, `src/lib/monitoring/today-intelligence.ts`.

---

## 4. Verification

| Check | Result |
|-------|--------|
| `npm test` | **213 passed** |
| `npm run build` | **OK** |
| Prod `GET /api/health` | **200** `database: connected` (2026-10-13, pre-PR deploy) |
| Prod Today → Map ×3 (authenticated) | **Not run in agent** — no `SESSION_SECRET` in this environment; acceptance remains for post-deploy smoke with Michael’s session. |
| Sydney index batches | **Not run** |

**Recommended post-deploy smoke:** Today → View on map for three `INDEX_DISCOVERY` candidates (incl. Bexley if listed) → confirm no stale scan cards, map centres on bbox, no `/api/scan` in network tab, repeat Today → Map → Today → second site.

---

## 5. Files touched

- `src/lib/map/map-target.ts`
- `src/lib/map-parcel-refresh.ts`
- `src/components/map/map-workspace.tsx`
- `src/components/monitoring/dashboard-client.tsx`
- `src/lib/monitoring/today-intelligence.ts`
- `tests/map-entity-target-scan.test.ts`
- `docs/harry-workflow-fix-2-report.md`
