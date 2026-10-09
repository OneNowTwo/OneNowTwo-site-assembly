# Source Watcher Phase 2 — Pre-merge hardening report

## Branch

| Item | Value |
|------|--------|
| Branch | `cursor/source-watcher-phase2-bcc3` |
| Repo | https://github.com/OneNowTwo/OneNowTwo-site-assembly |
| Merge | **Not merged to main** (per brief) |

## Production proposed-planning source path

```
Source Watcher adapters
  → persist PlanningChangeArea / KeySite (DB)
  → loadProposedPlanningAreas()          // persisted first
  → /api/planning/proposed (+ proposed-areas)
  → Planning UI / map toggle
```

- Fixtures used **only** when DB has zero `PlanningChangeArea` rows (`dataSource: "fixture_fallback"`).
- Response includes `dataSource` and `structuredDataStatus`.

## Parcel intersection method

`KeySite polygon ∩ cadastral parcel polygon` via `@turf/boolean-intersects` + `@turf/intersect` + `@turf/area`.

- Require intersection area ≥ 1 m² and ≥ 0.5% of `min(parcelArea, keySiteArea)`.
- Avoids first-ring-point / boundary-touch false positives.

## Address ↔ lot matching method

Same pattern as NSW cadastre provider:

1. Query property polygons (`principaladdresstype=1`) with geometry.
2. For each lot, `pointOnFeature(parcel)` → `booleanPointInPolygon` against property polygon.
3. **No array-index pairing** of addresses to lots.

Linked parcels expose `nsw-cadid:{cadid}`, address, and `addressMatchMethod: PROPERTY_CONTAINS_POINT | NONE`.

## Edgecliff data provenance

| Layer | Status |
|-------|--------|
| Portal page metadata | **LIVE** (title, Last-Modified, body hash, exhibition status) |
| Controls / geometry | **MANUALLY_STRUCTURED_FIXTURE** from official map pack |
| Official FeatureServer | **Not available** — portal lists PDFs only; `vectorServiceAvailable: false` |

Invalidation:

- Stable `documentHash` over structured pack (controls/geometry).
- Portal `bodyHash` change with same `documentHash` → `structuredDataStatus: NEEDS_RE_EXTRACTION` + `SOURCE_DOCUMENT_CHANGED` IntelChangeEvent.
- Does not silently keep presenting old structured controls as freshly extracted.

## Analyse Required Assembly flow

```
UI button
  → POST /api/planning/analyse-assembly
      { keySiteId, planningChangeAreaId, parcelIds?: nsw-cadid[] }
  → resolveParcelsForKeySite / getParcelsByExternalIds
  → createOpportunity(parcels)   // existing engine
  → { id, href: /opportunities/:id }
```

Uses real cadastral parcel IDs, not `?query=address1|address2`.

## Proposed scenario

`modelProposedScenario` still uses separate USER overrides through `analyseOpportunity` → `CalculationSnapshot`.

Confirmed engine outputs (not display-only FSR):

- theoreticalGfa / achievableGfa / saleableArea / dwellings  
- GRV / totalCost / maxPayable / headroom / score  
- unit mix row count / yield saleable + dwellings  

CURRENT opportunity inputs and PlanningSnapshot remain untouched.

## Report committed path (in branch)

- `docs/source-watcher-phase2-report.md`
- `docs/media/site-assembly-phase2-edgecliff-01.png`
- `docs/media/site-assembly-phase2-inner-west-01.png`

## Final verification

| Check | Result |
|-------|--------|
| `npm test` | **158 passed** / 27 files |
| `npm run typecheck` | **pass** |
| `npm run build` | **pass** (with `DATABASE_URL` set) |

Existing Map / Scan / Kenneth / Planning / Yield / Feasibility regression suites green (full vitest run).

## Scope

No HDA/SSD/DA Phase 3 work. No merge to `main`.
