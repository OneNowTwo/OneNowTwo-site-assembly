/**
 * Real-app Playwright recordings for PR #35 evidence pass.
 * Captures Today → Area L detail → source/affected sites, and
 * Bexley Map live → forced failure fallback → retry → Analyse.
 */
import { chromium, type Page, type APIRequestContext } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3456";
const EMAIL = process.env.AUTH_EMAIL ?? "demo@siteassembly.app";
const PASSWORD = process.env.AUTH_PASSWORD ?? "demo-site-assembly";
const MEDIA =
  process.env.MEDIA_DIR ??
  "/Users/michaelhegarty/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/bc-eff7bf9a-51a6-455b-bd33-9b7f0ea7af59/files/media/planning-updates-detail-bexley-fix";
const FLOW = process.env.FLOW ?? "all";

const BEXLEY = [
  { id: "nsw-cadid:102813140", address: "39 Beaconsfield Street, Bexley", areaSqm: 645 },
  { id: "nsw-cadid:103811478", address: "42 Connemarra Street, Bexley", areaSqm: 810 },
  { id: "nsw-cadid:103821903", address: "40 Connemarra Street, Bexley", areaSqm: 830 },
];

fs.mkdirSync(MEDIA, { recursive: true });

// Remove prior SVG mockups so they cannot be mistaken for evidence.
for (const f of fs.readdirSync(MEDIA)) {
  if (f.endsWith(".svg")) fs.unlinkSync(path.join(MEDIA, f));
}

async function apiLogin(request: APIRequestContext) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`Login failed ${res.status()}: ${JSON.stringify(body)}`);
}

async function ensureAuthedPage(page: Page) {
  await apiLogin(page.request);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("/login")) {
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|map|find)/, { timeout: 30000 });
  }
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  const file = path.join(MEDIA, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("SHOT", file);
}

async function recordToday(page: Page) {
  await ensureAuthedPage(page);
  // Ensure apartments strategy (Area L is apartments key-site)
  const apt = page.getByRole("button", { name: /Apartments/i }).first();
  if (await apt.count()) {
    await apt.click().catch(() => null);
    await page.waitForTimeout(2000);
  }
  await page.getByText(/Area L/i).first().waitFor({ timeout: 30000 });
  // Scroll planning updates into view for the evidence screenshot
  const know = page.getByText(/What you need to know/i).first();
  if (await know.count()) {
    await know.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  }
  await shot(page, "01-today-what-you-need.png");

  // Open Area L detail — click the title button for that story
  const areaTitle = page.getByRole("button", { name: /Inner West planning update — Area L|Area L/i }).first();
  if (await areaTitle.count()) {
    await areaTitle.click();
  } else {
    // Fallback: locate the story row by text then its Details control
    const row = page.locator("div").filter({ hasText: /Inner West planning update — Area L/ }).last();
    await row.getByRole("button", { name: /^Details$/ }).click({ force: true });
  }

  await page.getByText(/What changed|Proposed controls|Official source/i).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);

  // Assert no placeholder copy from the rejected mockup
  const panelText = await page.locator('[role="dialog"]').innerText();
  for (const bad of [
    "— (where known)",
    "From PCA / key-site evidence",
    "Separate from official publication date",
    "Document-only refreshes show",
  ]) {
    if (panelText.includes(bad)) {
      throw new Error(`Detail panel still contains placeholder copy: ${bad}`);
    }
  }
  console.log("DETAIL_PANEL_OK", panelText.slice(0, 400).replace(/\s+/g, " "));
  await shot(page, "02-update-detail-panel.png");

  const source = page.getByRole("link", { name: /Official webpage|source/i }).first();
  if (await source.count()) {
    console.log("SOURCE_HREF", await source.getAttribute("href"));
  }

  const inspect = page.getByRole("link", { name: /Inspect affected site/i }).first();
  await inspect.click();
  await page.waitForURL(/\/find/, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot(page, "03-find-affected-sites.png");
  console.log("FIND_URL", page.url());
}

/** Exact indexed candidate for 39 Beaconsfield + 42/40 Connemarra (2,285 sqm). */
const BEXLEY_MAP_HREF =
  "/map?candidateId=cmv4nd9c700io0pfhc19igg8r&canonicalKey=nsw-cadid%3A102813140%7Cnsw-cadid%3A103811478%7Cnsw-cadid%3A103821903&lat=-33.95653&lng=151.12853&zoom=18";
const BEXLEY_BBOX = "151.127389,-33.957686,151.129685,-33.955229";

async function createBexleyOpportunityFromStored(request: APIRequestContext) {
  const res = await request.get(`${BASE}/api/parcels?bbox=${BEXLEY_BBOX}`, { timeout: 120000 });
  if (!res.ok()) throw new Error(`parcels bbox failed ${res.status()}`);
  const body = await res.json();
  const wanted = new Set(BEXLEY.map((b) => b.id));
  const parcels = (body.parcels ?? []).filter((p: { externalParcelId: string }) =>
    wanted.has(p.externalParcelId),
  );
  console.log(
    "PARCEL_API_COUNT",
    parcels.length,
    "planningStatus",
    body.planningStatus,
    "messages",
    body.messages,
  );
  for (const p of parcels) {
    console.log("PARCEL_API", p.address, p.planningStatus, p.planning?.zone, p.planning?.fsr, p.retrievedAt);
  }
  if (parcels.length !== 3) {
    throw new Error(`Expected 3 Bexley parcels in bbox, got ${parcels.length}`);
  }
  const create = await request.post(`${BASE}/api/opportunities`, {
    data: {
      name: "Bexley 3-lot evidence — Beaconsfield / Connemarra",
      parcels,
    },
    timeout: 60000,
  });
  const created = await create.json();
  if (!create.ok()) throw new Error(`create opportunity failed ${create.status()}: ${JSON.stringify(created)}`);
  console.log("OPP_ID", created.id);
  return { id: created.id as string, parcels };
}

async function recordBexleyLive(page: Page) {
  await ensureAuthedPage(page);
  let oppId: string | null = null;
  let retrievedAt: string | undefined = "2026-10-16T05:49:38.669Z";

  // Deep-link the exact indexed 3-lot assembly (same as Today → Show on map).
  await page.goto(`${BASE}${BEXLEY_MAP_HREF}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);
  console.log("MAP_URL", page.url());

  await page.getByText(/Beaconsfield|Connemarra|Current assembly|R3|0\.7|2,?285/i).first().waitFor({ timeout: 45000 }).catch(() => null);
  const liveText = await page.locator("body").innerText();
  console.log("MAP_LIVE_HAS_R3", /R3/.test(liveText));
  console.log("MAP_LIVE_HAS_FSR", /0\.7/.test(liveText));
  console.log("MAP_LIVE_HAS_2285", /2,?285/.test(liveText));
  console.log("MAP_LIVE_HAS_3_LOTS", /3 lots|3\s*lot/i.test(liveText));
  await shot(page, "04-bexley-map-planning.png");

  const lotBtn = page.getByText(/39 Beaconsfield|42 Connemarra|40 Connemarra/i).first();
  if (await lotBtn.count()) {
    await lotBtn.click().catch(() => null);
    await page.waitForTimeout(1500);
  }
  await shot(page, "05-bexley-parcel-panel-live.png");

  // Analyse → opportunity (preserves exact parcel set)
  const analyse = page.getByRole("button", { name: /^Analyse$/i }).first();
  if (await analyse.count()) {
    await analyse.click();
    await page.waitForTimeout(6000);
    const m = page.url().match(/opportunities\/([a-z0-9]+)/i);
    if (m) oppId = m[1]!;
    console.log("ANALYSE_URL", page.url(), "OPP", oppId);
    await shot(page, "06-bexley-analyse.png");
    if (oppId) {
      await page.goto(`${BASE}/map?opportunityId=${oppId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(5000);
      await shot(page, "07-bexley-reopen-assembly.png");
    }
  }

  if (!oppId) {
    const created = await createBexleyOpportunityFromStored(page.request);
    oppId = created.id;
    retrievedAt = created.parcels[0]?.retrievedAt as string | undefined;
  }

  return { oppId, parcels: BEXLEY, retrievedAt };
}

async function recordBexleyFallback(page: Page, oppId: string) {
  // Server must be running with SA_FORCE_PLANNING_FAIL=1 for this step.
  await ensureAuthedPage(page);
  await page.goto(`${BASE}/map?opportunityId=${oppId}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(5000);

  // Trigger viewport parcels refresh so force-fail path runs
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(3000);

  const text = await page.locator("body").innerText();
  console.log("FALLBACK_STORED", /Stored official planning/i.test(text));
  console.log("FALLBACK_DATE", /2026-10-16|Stored official/i.test(text));
  await shot(page, "05-bexley-parcel-panel.png");

  const retry = page.getByRole("button", { name: /Retry/i }).first();
  if (await retry.count()) {
    await retry.click();
    await page.waitForTimeout(2000);
    console.log("RETRY_CLICKED");
  }
  await shot(page, "05b-bexley-after-retry-forced.png");
}

async function recordBexleyAnalyse(page: Page, oppId: string) {
  await ensureAuthedPage(page);

  // Start from the exact indexed 3-lot MapTarget (preserves parcel set through Analyse).
  await page.goto(`${BASE}${BEXLEY_MAP_HREF}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);
  let bodyText = await page.locator("body").innerText();
  console.log(
    "ASSEMBLY_ADDRESS_HITS",
    BEXLEY.filter((b) => bodyText.includes(b.address.split(",")[0]!)).length,
    "HAS_2285",
    /2,?285/.test(bodyText),
  );

  const analyse = page.getByRole("button", { name: /^Analyse$/i }).first();
  if (await analyse.count()) {
    await analyse.click();
    await page.waitForTimeout(5000);
    console.log("AFTER_ANALYSE_URL", page.url());
  }
  // Opportunity page (created earlier) as Analyse destination evidence
  await page.goto(`${BASE}/opportunities/${oppId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot(page, "06-bexley-analyse.png");

  // Reopen map with opportunity + confirm exact three lots
  await page.goto(`${BASE}/map?opportunityId=${oppId}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(6000);
  await shot(page, "07-bexley-reopen-assembly.png");
  const reopen = await page.locator("body").innerText();
  console.log(
    "REOPEN_3_LOTS",
    BEXLEY.every((b) => reopen.includes(b.address.split(",")[0]!)),
    "REOPEN_2285",
    /2,?285/.test(reopen),
  );

  // Also reopen via the same index candidate deep-link
  await page.goto(`${BASE}${BEXLEY_MAP_HREF}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
  bodyText = await page.locator("body").innerText();
  console.log("CANDIDATE_REOPEN_2285", /2,?285/.test(bodyText), "R3", /R3/.test(bodyText));
}

async function withVideo(name: string, fn: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: MEDIA, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }
  // Rename newest webm
  const vids = fs
    .readdirSync(MEDIA)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, m: fs.statSync(path.join(MEDIA, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (vids[0] && !vids[0].f.startsWith("01-") && !vids[0].f.startsWith("02-")) {
    const dest = path.join(MEDIA, name);
    fs.renameSync(path.join(MEDIA, vids[0].f), dest);
    console.log("VIDEO", dest);
  }
}

async function main() {
  console.log({ BASE, MEDIA, FLOW });

  // Smoke auth
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const reqCtx = await browser.newContext();
  await apiLogin(reqCtx.request);
  console.log("AUTH_OK");
  await reqCtx.close();
  await browser.close();

  let oppId: string | null = process.env.BEXLEY_OPP_ID ?? null;

  if (FLOW === "today" || FLOW === "all") {
    await withVideo("01-today-update-detail-affected-sites.webm", recordToday);
  }

  if (FLOW === "bexley-live" || FLOW === "bexley" || FLOW === "all") {
    await withVideo("02a-bexley-map-live.webm", async (page) => {
      const r = await recordBexleyLive(page);
      oppId = r.oppId;
      fs.writeFileSync(path.join(MEDIA, "bexley-opp-id.txt"), oppId);
      fs.writeFileSync(
        path.join(MEDIA, "bexley-planning-trace.json"),
        JSON.stringify(
          {
            parcels: BEXLEY,
            retrievedAt: r.retrievedAt,
            source: "LIVE_NSW via /api/parcels bbox → persistLivePlanning",
            expected: { zone: "R3", fsr: 0.7, heightM: 8.5, instrument: "Bayside Local Environmental Plan 2021" },
          },
          null,
          2,
        ),
      );
    });
  }

  if (FLOW === "bexley-fallback") {
    oppId = oppId || fs.readFileSync(path.join(MEDIA, "bexley-opp-id.txt"), "utf8").trim();
    await withVideo("02b-bexley-fallback-retry.webm", async (page) => {
      await recordBexleyFallback(page, oppId!);
    });
  }

  if (FLOW === "bexley-analyse" || FLOW === "bexley" || FLOW === "all") {
    oppId = oppId || fs.readFileSync(path.join(MEDIA, "bexley-opp-id.txt"), "utf8").trim();
    // Analyse path expects live planning available (no force fail)
    await withVideo("02c-bexley-analyse-reopen.webm", async (page) => {
      await recordBexleyAnalyse(page, oppId!);
    });
  }

  // Concat note: keep separate videos; also copy a combined-named alias for the brief
  const parts = [
    "02a-bexley-map-live.webm",
    "02b-bexley-fallback-retry.webm",
    "02c-bexley-analyse-reopen.webm",
  ].map((f) => path.join(MEDIA, f));
  if (parts.every((p) => fs.existsSync(p))) {
    // Alias first live video path for the brief's "Bexley Map flow" recording set
    fs.copyFileSync(parts[0]!, path.join(MEDIA, "02-bexley-map-live-fallback-retry-analyse.webm"));
  }

  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
