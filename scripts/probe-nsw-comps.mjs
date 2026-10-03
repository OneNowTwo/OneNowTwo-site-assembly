#!/usr/bin/env node
/**
 * Live probe: NSW registered comps valuation for Neutral Bay assembly addresses.
 * Usage: node scripts/probe-nsw-comps.mjs
 */
// Fallback centroids near 5 Reserve when PSI has no subject sale row (app uses cadastre centroids).
const SUBJECTS = [
  { label: "5 Reserve Street", house: "5", street: "RESERVE", suburb: "NEUTRAL BAY", areaSqm: 280, lng: 151.21907, lat: -33.83684 },
  { label: "1 Reserve Street", house: "1", street: "RESERVE", suburb: "NEUTRAL BAY", areaSqm: 300, lng: 151.2191, lat: -33.8366 },
  { label: "3 Reserve Street", house: "3", street: "RESERVE", suburb: "NEUTRAL BAY", areaSqm: 290, lng: 151.21908, lat: -33.83672 },
  { label: "57 Undercliff Street", house: "57", street: "UNDERCLIFF", suburb: "NEUTRAL BAY", areaSqm: 320, lng: 151.21855, lat: -33.8369 },
];

const BASE = process.env.NSW_PROPERTY_SALES_URL ?? "https://maps.six.nsw.gov.au/arcgis/rest/services/public/Valuation/MapServer";

function parseDate(s) {
  if (!s) return null;
  const d = new Date(`${s} UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function findSubject(s) {
  // Exact house number first — avoid LIKE '3%' matching unrelated lots.
  const where = `suburb = '${s.suburb}' AND street LIKE '%${s.street}%' AND house_no = '${s.house}'`;
  const u = new URL(`${BASE}/1/query`);
  u.searchParams.set("where", where);
  u.searchParams.set("outFields", "*");
  u.searchParams.set("returnGeometry", "true");
  u.searchParams.set("outSR", "4326");
  u.searchParams.set("f", "json");
  const res = await fetch(u);
  const json = await res.json();
  if (json.error) return null;
  const feats = (json.features ?? []).filter((f) => f.geometry?.x != null && f.geometry?.y != null);
  if (!feats.length) return null;
  const f = feats.sort((a, b) => String(b.attributes.last_sale).localeCompare(String(a.attributes.last_sale)))[0];
  return {
    lng: f.geometry.x,
    lat: f.geometry.y,
    lastSale: { price: f.attributes.price, date: f.attributes.sale_date, area: f.attributes.area },
    areaSqm: f.attributes.area > 0 ? f.attributes.area : s.areaSqm,
  };
}

async function compsNear(lng, lat, suburb, areaSqm) {
  const dLat = 1000 / 111320;
  const dLng = 1000 / (111320 * Math.cos((lat * Math.PI) / 180));
  const envelope = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
  const u = new URL(`${BASE}/1/query`);
  u.searchParams.set("where", `suburb = '${suburb}' AND strata = 0 AND price >= 500000`);
  u.searchParams.set("geometry", envelope);
  u.searchParams.set("geometryType", "esriGeometryEnvelope");
  u.searchParams.set("inSR", "4326");
  u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  u.searchParams.set("outFields", "house_no,street,suburb,price,sale_date,area,strata,dealing");
  u.searchParams.set("returnGeometry", "true");
  u.searchParams.set("outSR", "4326");
  u.searchParams.set("f", "json");
  const json = await (await fetch(u)).json();
  const cutoff = Date.now() - 24 * 30.4375 * 24 * 3600 * 1000;
  const rows = [];
  for (const f of json.features ?? []) {
    const a = f.attributes;
    const g = f.geometry;
    if (!g) continue;
    const dist = haversine(lng, lat, g.x, g.y);
    const dt = parseDate(a.sale_date);
    const area = a.area || 0;
    if (dist > 1000 || !dt || dt.getTime() < cutoff || area <= 0) continue;
    if (Math.abs(area - areaSqm) / areaSqm > 0.35) continue;
    const adj = a.price * (areaSqm / area);
    const age = (Date.now() - dt.getTime()) / (24 * 30.4375 * 24 * 3600 * 1000);
    const sim = 0.3 * (1 - dist / 1000) + 0.3 * (1 - Math.abs(area - areaSqm) / areaSqm) + 0.25 * Math.max(0, 1 - age) + 0.15;
    rows.push({ address: `${a.house_no} ${a.street}`, price: a.price, date: a.sale_date, area, dist, adj, sim });
  }
  rows.sort((a, b) => b.sim - a.sim);
  const med = rows.map((r) => r.adj).sort((a, b) => a - b)[Math.floor(rows.length / 2)] || 0;
  const picked = rows.filter((r) => med <= 0 || (r.adj / med >= 0.65 && r.adj / med <= 1.4)).slice(0, 8);
  let w = 0;
  let p = 0;
  for (const r of picked) {
    w += r.sim;
    p += r.adj * r.sim;
  }
  const mid = w ? Math.round(p / w) : null;
  const adjs = picked.map((r) => r.adj).sort((a, b) => a - b);
  const low = adjs[Math.floor(adjs.length * 0.2)] ?? null;
  const high = adjs[Math.floor(adjs.length * 0.8)] ?? null;
  return { mid, low: low ? Math.round(low) : null, high: high ? Math.round(high) : null, comps: picked };
}

async function main() {
  const out = [];
  for (const s of SUBJECTS) {
    const found = await findSubject(s);
    const lng = found?.lng ?? s.lng;
    const lat = found?.lat ?? s.lat;
    const areaSqm = found?.areaSqm ?? s.areaSqm;
    const est = await compsNear(lng, lat, s.suburb, areaSqm);
    out.push({
      label: s.label,
      subjectLastSale: found?.lastSale ?? null,
      subjectSaleFound: !!found,
      areaSqm,
      estimate: { mid: est.mid, low: est.low, high: est.high, comps: est.comps.length },
      topComps: est.comps.slice(0, 5).map((c) => ({
        address: c.address,
        price: c.price,
        date: c.date,
        area: c.area,
        distM: Math.round(c.dist),
        score: Math.round(c.sim * 100),
      })),
    });
  }
  const mids = out.map((o) => o.estimate?.mid).filter((n) => typeof n === "number");
  const combinedMid = mids.length ? mids.reduce((a, b) => a + b, 0) : null;
  console.log(
    JSON.stringify(
      {
        ok: mids.length > 0,
        label: "COMPARABLE-DERIVED SCREENING ESTIMATE",
        properties: out,
        combinedMid,
        combinedLow: out.reduce((s, o) => s + (o.estimate?.low ?? 0), 0) || null,
        combinedHigh: out.reduce((s, o) => s + (o.estimate?.high ?? 0), 0) || null,
        sanityNote: "5 Reserve consumer AVM ~$3.12m is external sanity only — not hardcoded.",
        licensing: "NSW PSI — MVP/research; commercial licence required before product sale.",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
