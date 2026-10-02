# Site Assembly

Finds ordinary adjoining residential lots in NSW that could be assembled into a development site, then works backwards from the development economics to what a developer can pay each owner — and tracks every property through an acquisition pipeline.

**FIND → ASSEMBLE → PLAN → YIELD → FEASIBILITY → RESIDUAL LAND VALUE → ACQUISITION BUDGET → OWNER STRATEGY → OFFER / APPROACH → PIPELINE**

Internal MVP for Sydney metropolitan residential. It assists the developer; it never contacts owners or makes offers.

## What it does

| Screen | What you get |
| --- | --- |
| **Map** | OpenStreetMap base, real NSW cadastral lots (zoom ≥ 17), zone-coloured fills, optional NSW LEP zoning WMS layer, address/suburb search. Click a lot for Lot/DP, area, zoning, FSR, height, minimum lot size, heritage, instrument — each with source and checked date. **Add to assembly** (or shift-click) and **Find assemblies**. |
| **Find assemblies** | Builds an adjacency graph of neighbouring lots and ranks connected 2–6 lot combinations by a transparent 0–100 opportunity score with the reasons (`+ 2,326 sqm combined site`, `− FSR estimated …`). **Analyse** saves it as an opportunity. |
| **Opportunity** | Tabs: Overview (why assembly creates value, score breakdown, include/exclude lots), Planning (per-lot controls, Official / User assumption / System estimate tags, re-check or manual entry), Yield, Feasibility (residual land value, max acquisition budget, cost table, "how this was calculated", price tests, base/upside/downside scenarios), Acquisition (offer allocation, owner premium, critical-lot analysis, approach sequence, owner details, approach brief, letter template, activity log). |
| **Opportunities** | All saved assemblies with score, GRV, max land budget, profit, acquisition progress, status; sort and filter. |
| **Acquisitions** | Board (drag between 15 stages) and list of every property across opportunities, with next actions. |
| **Assumptions** | Global defaults (margins, efficiency, costs, opening offer %, min viable site, max assembly size). Each opportunity can override any of them. |

## Architecture

- **Next.js 16 (App Router) + React 19 + TypeScript**, one web service. Route handlers under `src/app/api/*`; `src/proxy.ts` gates every page and API route behind the session cookie.
- **PostgreSQL + Prisma 7** (`prisma-client` generator, `@prisma/adapter-pg`). GeoJSON geometry is stored as JSONB — no PostGIS dependency.
- **Leaflet / React Leaflet** for mapping, **Turf.js** for geometry, **Zod** for validation, **Tailwind CSS 4** for styling.
- All analysis is pure TypeScript in `src/lib/analysis/` and runs both on the server (to persist summaries) and in the browser (instant recalculation while editing).

```
src/lib/data-sources/   nsw-cadastre.ts · nsw-planning.ts · geocoder.ts · http.ts (timeouts, retry, TTL cache) · providers.ts (interfaces)
src/lib/analysis/       geometry (adjacency) · assembly (metrics, score, generator) · yield · feasibility (RLV)
                        allocation · critical · strategy · approach · opportunity (orchestration) · assumptions
src/lib/parcel-service.ts       cadastre + planning merge, fallback to stored NSW snapshots
src/lib/opportunity-service.ts  create / load / recompute / persist
prisma/schema.prisma, prisma/migrations/, prisma/seed.mts
```

## Local setup

Requirements: Node 20.19+ (22 recommended), PostgreSQL 14+.

```bash
npm install                          # also runs prisma generate
cp .env.example .env                 # then edit — see below
createdb site_assembly               # or any Postgres database
npm run db:migrate                   # apply migrations (prisma migrate dev)
npm run db:seed                      # global assumptions + Neutral Bay demo opportunity
npm run dev                          # http://localhost:3000
```

Create a login: `npm run auth:hash -- 'choose-a-password'` and paste the `.env` line it prints.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `SESSION_SECRET` | yes (prod) | 32+ random characters; signs the session JWT. Dev falls back to an insecure constant. |
| `AUTH_EMAIL` | yes | The single internal login. |
| `AUTH_PASSWORD_HASH` | yes | bcrypt hash from `npm run auth:hash`. In `.env` files escape `$` as `\$` (Next.js expands variables); paste unescaped in Render. |
| `NSW_CADASTRE_URL`, `NSW_PLANNING_URL`, `NEXT_PUBLIC_NSW_PLANNING_WMS_URL`, `GEOCODER_URL` | no | Override the default endpoints. |

No plaintext passwords are stored anywhere in the repository.

### Scripts

`dev` · `build` · `start` · `lint` · `typecheck` · `test` · `db:migrate` · `db:deploy` · `db:seed` · `db:reset-demo` · `demo:snapshot` · `auth:hash`

## NSW data adapters

| Data | Source (live) | Adapter |
| --- | --- | --- |
| Lot boundaries, Lot/Section/DP, title area | NSW Spatial Services — `NSW_Land_Parcel_Property_Theme` FeatureServer, layer 8 (Lot) | `nsw-cadastre.ts` |
| Street addresses | Same service, layer 12 (Property), principal addresses, matched by point-in-polygon | `nsw-cadastre.ts` |
| Zoning, FSR, Height of Buildings, Lot Size, Heritage, instrument, LGA | NSW Planning Portal / DPHI — `Planning/EPI_Primary_Planning_Layers` MapServer, layers 2, 1, 5, 4, 0 | `nsw-planning.ts` |
| Zoning map overlay | Same service via WMS | map component |
| Geocoding | OpenStreetMap Nominatim (no key, NSW-bounded), with a built-in suburb list fallback | `geocoder.ts` |
| Base map | OpenStreetMap tiles | map component |

Each viewport request queries the cadastre once per layer and each planning layer once by bounding box, then assigns controls to lots by point-in-polygon (≈2–5 s for a few hundred lots). Requests have timeouts, one retry and a 10-minute in-process cache.

**Failure handling.** If the planning service is down, parcels still load and show *"Planning service temporarily unavailable."* with Retry; saved opportunities keep their planning snapshot and the Planning tab accepts manual controls (tagged *User assumption*). If the cadastre is down, the map shows previously saved NSW parcels for that area (labelled *NSW data · saved snapshot*). Every saved parcel stores a `PlanningSnapshot` with per-field source and retrieval time.

### Known data limitations

- **FSR is not mapped for many residential zones** (e.g. North Sydney R2/R3/R4 are height-controlled). The app then shows *Not mapped* and uses a labelled **system estimate**: storeys under the height control × site coverage for apartment-capable zones, otherwise the fallback FSR assumption. Override on the Yield tab.
- Heritage is point-in-polygon at each lot's interior point; partially affected lots can be missed.
- Strata schemes appear as one common-property lot (plan `SP…`); they're flagged and excluded from automatic assembly.
- Addresses come from principal-address property records; some lots (lanes, common property) have none.
- No sales or valuation data: market values are developer estimates.

## How the calculations work

**Yield** — GFA = site area × FSR; saleable = GFA × efficiency; dwellings = ⌊saleable ÷ average dwelling size⌋; storeys = ⌈GFA ÷ (site × coverage)⌉, checked against the height control.

**Costs (C, non-land)** — construction ($/sqm GFA) + demolition (per lot) + consultants (% construction) + statutory fees (per dwelling) + contingency (% of construction, demolition, consultants) + marketing and selling (% GRV) + other, plus development finance (% of those).

**Residual land value** — land-dependent costs are solved, not double counted. With purchase price *P* and k = 1 + acquisition cost % + land holding %, total land cost L = P × k.

- Margin on cost *M*: GRV = (C + L)(1 + M) ⇒ **L = GRV ÷ (1 + M) − C**
- Margin on revenue *m*: **L = GRV × (1 − m) − C**
- **Maximum acquisition budget P = L ÷ k** — the total payable to all owners.

**Offer allocation** — lot weight = lot value ÷ combined value; maximum allocation = budget × weight (manual overrides honoured, remainder re-shared); opening offer = maximum × opening % (default 85%); indicative owner premium = offer ÷ value − 1.

**Critical lots** — each lot is removed and the economics re-run. CRITICAL if the remainder fragments (graph cut vertex), falls below the minimum viable site, loses ≥ 30% of area/GFA, or can no longer pay the other owners' market value; otherwise OPTIONAL.

**Acquisition sequence** — critical connectors first, then other critical lots by graph degree and area, a "secure the core" milestone, then optional lots.

**Opportunity score (0–100)** — site size 25%, planning capacity 25%, assembly simplicity 15%, development uplift 25% (indicative budget ÷ existing value), planning constraints 10%. Every component and factor is shown.

**Scenarios** — downside / base / upside adjust sale price, build cost, FSR, finance rate and target margin.

Unit tests (`npm test`) cover residual land value (both margin bases, land-dependent costs), cost build-up, yield, offer allocation, combined area and FSR weighting, adjacency (tolerance and corner contact), connectivity, assembly generation bounds, critical-lot logic, lot removal, and scenarios.

## Demo data

`npm run db:seed` creates **Neutral Bay Assembly Demo** on five **real adjoining cadastral lots**: 66, 64, 62 and 60 Undercliff Street (Lots 1–4 DP21192) and 81 Ben Boyd Road (Lot 1 DP78216), Neutral Bay. Their geometry, Lot/DP and planning controls come from the live NSW services at seed time, or from `prisma/seed-data/neutral-bay-demo-parcels.json` (a snapshot of the same live responses) when offline.

Only the **market values ($1.21m–$1.48m), owners, notes and pipeline stages are fictional** and are badged **DEMO FINANCIAL DATA** throughout. The mapped controls are R3 / 8.5 m / no FSR; the demo applies an explicit *User assumption* of FSR 1.4:1 and 12 m height to test a planning-proposal scenario, which shows the assembly value: five houses worth $6.7m combined support a maximum land budget of about $15m at a 20% margin on cost.

`npm run db:reset-demo` recreates it; `npm run demo:snapshot` refreshes the offline snapshot.

## Deploying to Render

`render.yaml` provisions a Node web service and a Render PostgreSQL 16 database (Singapore, closest region to Sydney).

1. Push this repository to GitHub.
2. Render Dashboard → **New → Blueprint** → select the repo.
3. Enter `AUTH_EMAIL` and `AUTH_PASSWORD_HASH` when prompted. `SESSION_SECRET` is generated and `DATABASE_URL` is wired from the database automatically.

Build: `npm ci && npx prisma generate && npm run build`. Pre-deploy: `prisma migrate deploy && npm run db:seed` (idempotent). Health check: `GET /api/health` → `{"status":"ok","database":"connected"}`.

Plans default to `starter` (web) and `basic-256mb` (database). To use free plans, set both `plan: free`, remove `preDeployCommand` (not available on free) and use `startCommand: npm run start:render`, which runs migrations and seed before `next start`.

## Future integrations

Interfaces in `src/lib/data-sources/providers.ts`: `CadastreProvider`, `PlanningDataProvider`, `GeocoderProvider`, `PropertyValuationProvider` (CoreLogic / PriceFinder / Domain / licensed NSW sales), `OwnerDataProvider` (title search), `ConstructionCostProvider`, `ComparableSalesProvider`, `AIAnalysisProvider`. Later: suburb-wide scanning, planning-change alerts, comparable sales, massing / test-fit, DA history, team collaboration, other states.

## MVP limitations

- Feasibility is **indicative only** — not a valuation, QS estimate, or tax/legal model.
- Planning controls **must be verified** by a qualified planner and the consent authority.
- **No automated title or owner lookup**; owner details are entered manually.
- Market values are **user estimates** unless licensed data is added.
- **No architectural test-fit**; yield ignores setbacks, ADG separation, deep soil, etc.
- **No automatic legal offers** or owner contact — letters and briefs are templates to copy.
- Single admin login; no multi-user permissions.
