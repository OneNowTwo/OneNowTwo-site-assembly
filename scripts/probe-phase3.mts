import { runSourceOnce } from "../src/lib/source-watcher/pipeline";
for (const id of ["nsw-hda-records", "nsw-major-projects", "nsw-da-cdc-pcc"] as const) {
  const r = await runSourceOnce(id, null);
  const meta = (r.normalised?.meta ?? {}) as Record<string, unknown>;
  console.log(
    JSON.stringify({
      id,
      status: r.status,
      metaStatus: meta.status,
      records: r.normalised?.records?.length ?? 0,
      areas: r.normalised?.planningChangeAreas?.length ?? 0,
      note: String(meta.note ?? meta.openDataError ?? r.error ?? "").slice(0, 160),
    }),
  );
}
// PPR can be slow — run with timeout awareness
const ppr = await runSourceOnce("nsw-planning-proposal-register", null);
const meta = (ppr.normalised?.meta ?? {}) as Record<string, unknown>;
console.log(
  JSON.stringify({
    id: "nsw-planning-proposal-register",
    status: ppr.status,
    metaStatus: meta.status,
    records: ppr.normalised?.records?.length ?? 0,
    areas: ppr.normalised?.planningChangeAreas?.length ?? 0,
    note: String(meta.note ?? ppr.error ?? "").slice(0, 160),
  }),
);
