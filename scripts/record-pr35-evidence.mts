/**
 * Real-app Playwright evidence for PR #35 — hard-fails on workflow failure.
 * No API-created opportunity substitutes for a failed Analyse navigation.
 *
 * FLOWs: today | bexley-live | bexley-fallback | bexley-recover | bexley-analyse | all
 */
import { chromium, type Page, type APIRequestContext } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
] as const;
const BEXLEY_TOTAL = 2285;
const BEXLEY_MAP_HREF =
  "/map?candidateId=cmv4nd9c700io0pfhc19igg8r&canonicalKey=nsw-cadid%3A102813140%7Cnsw-cadid%3A103811478%7Cnsw-cadid%3A103821903&lat=-33.95653&lng=151.12853&zoom=18";
const BEXLEY_BBOX = "151.127389,-33.957686,151.129685,-33.955229";

fs.mkdirSync(MEDIA, { recursive: true });
for (const f of fs.readdirSync(MEDIA)) {
  if (f.endsWith(".svg")) fs.unlinkSync(path.join(MEDIA, f));
}

function fail(msg: string): never {
  throw new Error(`EVIDENCE_FAIL: ${msg}`);
}

function assertAssembly(text: string, where: string) {
  for (const b of BEXLEY) {
    const short = b.address.split(",")[0]!;
    if (!text.includes(short)) fail(`${where}: missing address ${short}`);
  }
  if (!new RegExp(String(BEXLEY_TOTAL)).test(text.replace(/,/g, ""))) {
    // allow "2,285" or "2285"
    if (!/2,?285/.test(text)) fail(`${where}: missing total area 2,285 sqm`);
  }
  if (!/3\s*lots?/i.test(text)) fail(`${where}: missing 3 lots`);
}

async function apiLogin(request: APIRequestContext) {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) fail(`Login failed ${res.status()}: ${JSON.stringify(body)}`);
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
  await page.waitForTimeout(1200);
}

async function shot(page: Page, name: string) {
  const file = path.join(MEDIA, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("SHOT", file);
}

async function livePlanningTrace(request: APIRequestContext) {
  const res = await request.get(`${BASE}/api/parcels?bbox=${BEXLEY_BBOX}`, { timeout: 120000 });
  if (!res.ok()) fail(`parcels bbox ${res.status()}`);
  const body = await res.json();
  const wanted = new Set<string>(BEXLEY.map((b) => b.id));
  const parcels = (body.parcels ?? []).filter((p: { externalParcelId: string }) => wanted.has(p.externalParcelId));
  if (parcels.length !== 3) fail(`expected 3 Bexley parcels, got ${parcels.length}`);
  for (const p of parcels) {
    if (p.planning?.zone !== "R3" || p.planning?.fsr !== 0.7) {
      fail(`live planning mismatch for ${p.address}: ${JSON.stringify(p.planning)}`);
    }
    if (!p.retrievedAt) fail(`missing retrievedAt for ${p.address}`);
  }
  const retrievedAts = parcels.map((p: { retrievedAt: string }) => p.retrievedAt);
  return {
    parcels: parcels.map((p: { externalParcelId: string; address: string; retrievedAt: string; planning: unknown }) => ({
      id: p.externalParcelId,
      address: p.address,
      retrievedAt: p.retrievedAt,
      planning: p.planning,
    })),
    retrievedAts,
    planningStatus: body.planningStatus,
  };
}

async function recordToday(page: Page) {
  await ensureAuthedPage(page);
  const apt = page.getByRole("button", { name: /Apartments/i }).first();
  if (await apt.count()) {
    await apt.click().catch(() => null);
    await page.waitForTimeout(2000);
  }
  await page.getByText(/Area L/i).first().waitFor({ timeout: 30000 });
  const know = page.getByText(/What you need to know/i).first();
  if (await know.count()) await know.scrollIntoViewIfNeeded();
  await shot(page, "01-today-what-you-need.png");

  const areaTitle = page.getByRole("button", { name: /Inner West planning update — Area L|Area L/i }).first();
  if (!(await areaTitle.count())) fail("Area L title button not found on Today");
  await areaTitle.click();
  await page.getByText(/What changed|Proposed controls|Official source|Screening sample/i).first().waitFor({ timeout: 15000 });
  const panelText = await page.locator('[role="dialog"]').innerText();
  for (const bad of ["— (where known)", "From PCA / key-site evidence", "Separate from official publication date"]) {
    if (panelText.includes(bad)) fail(`placeholder copy still present: ${bad}`);
  }
  await shot(page, "02-update-detail-panel.png");

  const inspect = page.getByRole("link", { name: /Inspect affected site/i }).first();
  if (!(await inspect.count())) fail("Inspect affected sites link missing");
  await Promise.all([page.waitForURL(/\/find/, { timeout: 30000 }), inspect.click()]);
  await page.waitForTimeout(3500);
  await shot(page, "03-find-affected-sites.png");
  const findUrl = page.url();
  if (!/[?&](pca|keySite|keySites)=/.test(findUrl)) fail(`Find URL missing pca/keySite: ${findUrl}`);
  const findText = await page.locator("body").innerText();
  // Must show some result row or an explicit empty state — not a blank crash.
  if (!/result|site|assembl|Area L|Inner West|No /i.test(findText)) {
    fail("Find page after Today link did not show usable affected-site results");
  }
  console.log("FIND_URL", findUrl);
}

async function recordBexleyLive(page: Page) {
  await ensureAuthedPage(page);
  const trace = await livePlanningTrace(page.request);
  fs.writeFileSync(
    path.join(MEDIA, "bexley-planning-trace.json"),
    JSON.stringify(
      {
        parcels: BEXLEY,
        retrievedAts: trace.retrievedAts,
        planningStatus: trace.planningStatus,
        source: "LIVE_NSW via /api/parcels (observed at recording time — not hard-coded)",
        expected: { zone: "R3", fsr: 0.7, heightM: 8.5 },
      },
      null,
      2,
    ),
  );

  await page.goto(`${BASE}${BEXLEY_MAP_HREF}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);
  const liveText = await page.locator("body").innerText();
  assertAssembly(liveText, "live map");
  if (!/R3/.test(liveText) || !/0\.7/.test(liveText)) fail("live map missing R3 / 0.7");
  await shot(page, "04-bexley-map-planning.png");

  const lotBtn = page.getByText(/39 Beaconsfield/i).first();
  if (await lotBtn.count()) {
    await lotBtn.click();
    await page.waitForTimeout(1200);
  }
  await shot(page, "05-bexley-parcel-panel-live.png");

  // Analyse must navigate via UI — no API substitute.
  const analyse = page.getByRole("button", { name: /^Analyse$/i }).first();
  if (!(await analyse.count())) fail("Analyse button not found on live map");
  await Promise.all([
    page.waitForURL(/\/opportunities\/[a-z0-9]+/i, { timeout: 45000 }),
    analyse.click(),
  ]);
  const oppMatch = page.url().match(/opportunities\/([a-z0-9]+)/i);
  if (!oppMatch) fail(`Analyse did not navigate to opportunity: ${page.url()}`);
  const oppId = oppMatch[1]!;
  fs.writeFileSync(path.join(MEDIA, "bexley-opp-id.txt"), oppId);
  await page.waitForTimeout(2500);
  await shot(page, "06-bexley-analyse.png");
  console.log("ANALYSE_OK", page.url());

  // Reopen map with opportunity — exact three lots must survive.
  await page.goto(`${BASE}/map?opportunityId=${oppId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);
  const reopen = await page.locator("body").innerText();
  assertAssembly(reopen, "reopen opportunity map");
  await shot(page, "07-bexley-reopen-assembly.png");
  return { oppId, retrievedAts: trace.retrievedAts };
}

async function recordBexleyFallback(page: Page, oppId: string) {
  // Requires SA_FORCE_PLANNING_FAIL=1 on the server.
  await ensureAuthedPage(page);
  await page.goto(`${BASE}/map?opportunityId=${oppId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(3500);
  const text = await page.locator("body").innerText();
  assertAssembly(text, "forced-failure map");
  if (!/Stored official planning/i.test(text)) fail("forced failure did not show Stored official planning");
  // Date must come from persisted source timestamp (YYYY-MM-DD), not a hard-coded script constant.
  if (!/Stored official planning \(\d{4}-\d{2}-\d{2}\)/.test(text)) {
    fail("stored planning message missing retrieval date from evidence");
  }
  await shot(page, "05-bexley-parcel-panel.png");

  const retry = page.getByRole("button", { name: /Retry/i }).first();
  if (!(await retry.count())) fail("Retry button missing under forced failure");
  await retry.click();
  await page.waitForTimeout(2500);
  const after = await page.locator("body").innerText();
  assertAssembly(after, "after retry under forced failure");
  await shot(page, "05b-bexley-after-retry-forced.png");
}

async function recordBexleyRecover(page: Page, oppId: string) {
  // Requires SA_FORCE_PLANNING_FAIL unset — live recovery after forced failure.
  await ensureAuthedPage(page);
  await page.goto(`${BASE}/map?opportunityId=${oppId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);
  const retry = page.getByRole("button", { name: /Retry/i }).first();
  if (await retry.count()) {
    await retry.click();
    await page.waitForTimeout(4000);
  }
  const text = await page.locator("body").innerText();
  assertAssembly(text, "live recovery");
  if (!/R3/.test(text) || !/0\.7/.test(text)) fail("live recovery missing R3 / 0.7");
  await shot(page, "05c-bexley-live-recovery.png");
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
  const vids = fs
    .readdirSync(MEDIA)
    .filter((f) => f.endsWith(".webm") && !/^(01-|02)/.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(MEDIA, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (vids[0]) {
    const dest = path.join(MEDIA, name);
    fs.renameSync(path.join(MEDIA, vids[0].f), dest);
    console.log("VIDEO", dest);
  }
}

function concatCombinedVideo() {
  const parts = [
    "02a-bexley-map-live.webm",
    "02b-bexley-fallback-retry.webm",
    "02c-bexley-live-recovery.webm",
    "02d-bexley-analyse-reopen.webm",
  ]
    .map((f) => path.join(MEDIA, f))
    .filter((p) => fs.existsSync(p));
  const out = path.join(MEDIA, "02-bexley-map-live-fallback-retry-analyse.webm");
  if (parts.length < 2) {
    fail("combined video requires at least two segment recordings — refusing to copy live-only");
  }
  // Prefer ffmpeg concat when available.
  const list = path.join(MEDIA, "_concat.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const ff = spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], {
    encoding: "utf8",
  });
  fs.unlinkSync(list);
  if (ff.status === 0 && fs.existsSync(out)) {
    console.log("COMBINED_VIDEO_FFMPEG", out);
    return;
  }
  // Fallback: binary-append is invalid for webm — instead write a manifest and
  // copy the longest multi-segment set by requiring all parts exist and using
  // the fallback/analyse segment as the named combined file is still wrong.
  // Soft requirement: produce a real multi-flow recording by re-encoding via playwright is heavy.
  // If ffmpeg missing, stitch by recording a note manifest and fail loudly unless FORCE_COMBINED_COPY=1.
  if (process.env.FORCE_COMBINED_COPY === "1") {
    fs.copyFileSync(parts[parts.length - 1]!, out);
    console.warn("COMBINED_VIDEO_FALLBACK_COPY", out);
    return;
  }
  fail(`ffmpeg concat failed (status ${ff.status}): ${(ff.stderr || "").slice(0, 400)}`);
}

async function main() {
  console.log({ BASE, MEDIA, FLOW });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const reqCtx = await browser.newContext();
  await apiLogin(reqCtx.request);
  console.log("AUTH_OK");
  await reqCtx.close();
  await browser.close();

  let oppId: string | null = process.env.BEXLEY_OPP_ID ?? null;
  if (!oppId && fs.existsSync(path.join(MEDIA, "bexley-opp-id.txt"))) {
    oppId = fs.readFileSync(path.join(MEDIA, "bexley-opp-id.txt"), "utf8").trim();
  }

  if (FLOW === "today" || FLOW === "all") {
    await withVideo("01-today-update-detail-affected-sites.webm", recordToday);
  }

  if (FLOW === "bexley-live" || FLOW === "bexley" || FLOW === "all") {
    await withVideo("02a-bexley-map-live.webm", async (page) => {
      const r = await recordBexleyLive(page);
      oppId = r.oppId;
    });
  }

  if (FLOW === "bexley-fallback") {
    if (!oppId) fail("bexley-fallback requires opp id from live Analyse");
    await withVideo("02b-bexley-fallback-retry.webm", async (page) => {
      await recordBexleyFallback(page, oppId!);
    });
  }

  if (FLOW === "bexley-recover") {
    if (!oppId) fail("bexley-recover requires opp id");
    await withVideo("02c-bexley-live-recovery.webm", async (page) => {
      await recordBexleyRecover(page, oppId!);
    });
  }

  if (FLOW === "bexley-analyse") {
    // Analyse already recorded in live; re-verify reopen only (must still be UI opportunity).
    if (!oppId) fail("bexley-analyse requires opp id from live Analyse");
    await withVideo("02d-bexley-analyse-reopen.webm", async (page) => {
      await ensureAuthedPage(page);
      await page.goto(`${BASE}${BEXLEY_MAP_HREF}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(6000);
      const before = await page.locator("body").innerText();
      assertAssembly(before, "pre-analyse candidate");
      const analyse = page.getByRole("button", { name: /^Analyse$/i }).first();
      if (!(await analyse.count())) fail("Analyse missing on re-verify");
      await Promise.all([
        page.waitForURL(/\/opportunities\/[a-z0-9]+/i, { timeout: 45000 }),
        analyse.click(),
      ]);
      await shot(page, "06-bexley-analyse.png");
      await page.goto(`${BASE}/map?opportunityId=${oppId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(6000);
      const after = await page.locator("body").innerText();
      assertAssembly(after, "post-analyse reopen");
      await shot(page, "07-bexley-reopen-assembly.png");
    });
  }

  if (FLOW === "combine" || FLOW === "all") {
    // `all` does not run fallback/recover (needs server env flips) — combine only when segments exist.
    const needed = ["02a-bexley-map-live.webm", "02b-bexley-fallback-retry.webm", "02d-bexley-analyse-reopen.webm"];
    if (needed.every((f) => fs.existsSync(path.join(MEDIA, f)))) {
      concatCombinedVideo();
    } else {
      console.log("COMBINED_SKIP_missing_segments", needed.filter((f) => !fs.existsSync(path.join(MEDIA, f))));
    }
  }

  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
