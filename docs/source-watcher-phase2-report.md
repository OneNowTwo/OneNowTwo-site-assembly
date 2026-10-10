# Source Watcher Phase 2 — Report

## 1. Branch / commit

| Item | Value |
|------|--------|
| Repo | https://github.com/OneNowTwo/OneNowTwo-site-assembly |
| Branch | `cursor/source-watcher-phase2-bcc3` |
| Base | Phase 1 tip `02406b2` on `cursor/source-watcher-intel-engine-bcc3` |
| Tip commits | `f23324f` Phase 2 implementation; follow-up barrel export |
| Bundle | `/cursor/stores/bc-eff7bf9a-51a6-455b-bd33-9b7f0ea7af59/internal/site-assembly-source-watcher-phase2.bundle` |
| PR status | Branch pushed. Open via https://github.com/OneNowTwo/OneNowTwo-site-assembly/pull/new/cursor/source-watcher-phase2-bcc3 (agent PR tool is wired to PropTrackr workspace, not this remote). |
| Merge / redeploy | **Not merged to `main` / not redeployed.** Phase 1+2 remain on feature branch pending PR review. |

## 2. Exact live sources implemented

| Source id | Authority | Transport | Poll | Notes |
|-----------|-----------|-----------|------|-------|
| `live-edgecliff-woollahra` | NSW DPHI | HTML portal + structured map pack | every_6_hours | https://www.planningportal.nsw.gov.au/ppr/under-exhibition/edgecliff-woollahra-precinct |
| `live-inner-west-fairer-future` | Inner West Council | ArcGIS Experience → FeatureServer | daily | https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page |
| `nsw-spatial-lmr-viewer` | NSW DPHI / Spatial | ArcGIS Experience audit | daily | https://spatialportal.dpie.nsw.gov.au/portal/apps/experiencebuilder/experience/?id=c53d5767b677454c8a26d6790a296bc2 |
| `fixture-edgecliff-woollahra` / `fixture-inner-west-fairer-future` | — | FIXTURE | daily | Retained for offline unit tests / diff demos |

## 3. ArcGIS services discovered

### Inner West Experience `2b5ffd9da4f44cd7b7886b632a180556`
- WebMap: `df19b896a7f348a5a1d4842d8658be6c` (Current and Endorsed Planning Controls Map)
- Draft FeatureServer: `https://services-ap1.arcgis.com/dp2UIID5MUpTUFVA/arcgis/rest/services/Adopted_Planning_Layers/FeatureServer`
- Developer-relevant draft layers (ids): LZN 1, FSR 3, HOB 5, KYS 7, IFS 15, IHB 16, AHC 18 (+ MSF, IMS, PRM/PRD, IST, SEP, LRA, heritage)
- Current counterparts point at NSW `mapprod3` Principal_Planning / Development_Control (not ingested as PROPOSED)

### NSW Spatial LMR Viewer `c53d5767b677454c8a26d6790a296bc2`
- Unique / useful: `spatialportalarcgis…/LMR/LMR/MapServer` (+ `/0`)
- Duplicates / non-control: World Imagery, Boundaries_and_Places, AddressSearch MapServer
- Verdict: LMR proximity **fallback** only — do not replace EPI Primary Planning Layers for CURRENT law. Suitable for scheduled metadata ingestion.

## 4. API/vector vs PDF-derived

| Dataset | Geometry source |
|---------|-----------------|
| Inner West draft LZN/FSR/HOB/KYS/IFS/IHB/AHC | `OFFICIAL_FEATURE_SERVICE` |
| Edgecliff proposed controls / key sites | `MANUALLY_STRUCTURED_FIXTURE` from official exhibition map pack + live portal Last-Modified |
| Edgecliff portal page | Live HTML HEAD/GET (status / Last-Modified) — not geometry |

PDF is **not** OCR’d; structured pack carries machine-readable proposed controls until an official FeatureServer appears.

## 5. Edgecliff real parcel test

- Point inside CS7.2 bbox `(151.238, -33.8795)` → PlanningChangeArea + Key Site CS7.2
- Live adapter `SUCCEEDED` (2026-10-09): portal title “Edgecliff Woollahra Precinct…”, `Last-Modified: Fri, 09 Oct 2026 04:29:30 GMT`, status `UNDER_EXHIBITION`
- Proposed: zone B4, incentive FSR 2.5:1 (bump fixture 2.7 for change test), height 55 m, AH 5%, active frontage, 4 required parcel hints
- CURRENT PlanningSnapshot path unchanged (test E)

<img alt="Edgecliff CURRENT vs PROPOSED" src="docs/media/site-assembly-phase2-edgecliff-01.png" />

## 6. Inner West real parcel test

- Live adapter `SUCCEEDED`: 30 key sites sampled from draft KYS layer; WebMap `df19b896…`
- Point `(151.156, -33.91)` FeatureServer query: zone **E1**, draft FSR **3.5**, height **30 m**, AH label **AHC 2%**, geometry `OFFICIAL_FEATURE_SERVICE`
- No Experience canvas scrape

<img alt="Inner West ArcGIS resolve" src="docs/media/site-assembly-phase2-inner-west-01.png" />

## 7. KeySite ↔ parcel link result

- `resolveParcelsForKeySite` queries NSW cadastre lot/property layers by KeySite bbox/geometry
- Falls back to `requiredParcelHints` when cadastre unavailable
- CS7.2 fixture: 4 required lots + structured conditions (`THROUGH_SITE_LINK`, `ACTIVE_STREET_FRONTAGE`, `NON_RESIDENTIAL_FSR`, `AFFORDABLE_HOUSING`)
- UI: Planning panel lists assembly + **Analyse required assembly** (opens map with hints)

## 8. Proposed scenario result

- `modelProposedScenario` runs `analyseOpportunity` with temporary USER FSR/height overrides
- Returns separate `CalculationSnapshot` pair: CURRENT vs PROPOSED + uplift
- Does **not** mutate opportunity inputs or PlanningSnapshot (tests E/F)

## 9. TODAY change event result

- Live adapters wired into Phase 1 diff + persist + feed publish
- FSR 2.5 → 2.7 → one `FSR_PROPOSED_CHANGE` (test G)
- Unchanged re-run → `UNCHANGED`, zero events (test H)
- Watch linkage: `linkEventsToWatches` attaches `watchItemIds` when watch bbox intersects event/area envelope; stored on `IntelChangeEvent.watchItemIds` + feed payload

## 10. Existing regression tests

```
tests/source-watcher-phase2.test.ts     PASS (14)
tests/source-watcher.test.ts            PASS
tests/kenneth-fsr-sync.test.ts          PASS
tests/planning-change-engine.test.ts    PASS
tests/planning-snapshot-coherence.test.ts PASS
tests/simplify-mvp-economics.test.ts    PASS
```

`npm run build` succeeds with `DATABASE_URL` set (TypeScript clean; new routes `/api/planning/proposed` + `/api/planning/proposed-areas`).

## 11. Source failures / limitations

- Edgecliff has **no official FeatureServer** for exhibition layers yet → structured fixture geometry
- Cadastre parcel resolve depends on live NSW Spatial; tests use hints
- Screenshots in `media/` are schematic UI proofs (no headed browser in this agent environment)
- ManagePullRequest cannot open PRs against OneNowTwo-site-assembly from the PropTrackr-linked agent workspace

## 12. Still using fixtures

- Unit tests / FSR bump demos: `fixture-edgecliff-*`, `fixture-inner-west-*`
- Edgecliff production adapter still embeds structured map-pack JSON for controls/geometry while portal metadata is live
- Inner West production path is live FeatureServer (fixtures only as fallback for offline `loadFixturePlanningAreas` until DB-hydrated areas are preferred)

## 13. Phase 3 suggestions

1. Prefer DB-hydrated `PlanningChangeArea`/`KeySite` over fixture loader for site/map APIs after cron
2. Edgecliff official vector when DPHI publishes FeatureServer — swap geometry source
3. Full ANALYSE REQUIRED ASSEMBLY → existing assembly create with resolved cadastre IDs
4. Natural-language Find over the Phase 2 queryable fields
5. Merge Phase 1+2 → `main` → Render redeploy; enable cron for `live-*` sources only (fixture polls optional/off in prod)
6. Persist proposed-scenario result as optional side channel on opportunity without touching CURRENT inputs

## Continuity confirmation

- No new app; Map / Scan / Opportunities / Planning / Yield / Feasibility retained
- CURRENT LAW → PlanningSnapshot only
- PROPOSED → PlanningChangeArea / KeySite / Source Watcher only
- MODEL PROPOSED SCENARIO is opt-in and separate
