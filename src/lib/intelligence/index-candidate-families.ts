/**
 * Deterministic INDEX_DISCOVERY family grouping by overlapping / subset parcel sets.
 * Does not delete candidates, change canonicalKey, or merge unrelated neighbours.
 */

export type IndexFamilyMember = {
  id: string;
  canonicalKey: string;
  parcelIds: string[];
  score: number;
  siteAreaSqm: number | null;
  lotCount: number | null;
};

export type IndexCandidateFamily = {
  familyId: string;
  best: IndexFamilyMember;
  alternatives: IndexFamilyMember[];
};

function parcelSet(ids: string[]): Set<string> {
  return new Set(ids.filter(Boolean));
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** True when parcel sets overlap as subset/superset or Jaccard ≥ threshold. */
export function sameIndexFamily(
  aIds: string[],
  bIds: string[],
  similarity = 0.55,
): boolean {
  const a = parcelSet(aIds);
  const b = parcelSet(bIds);
  if (!a.size || !b.size) return false;
  if (isSubset(a, b) || isSubset(b, a)) return true;
  return jaccard(a, b) >= similarity;
}

/**
 * Group candidates into families; best = highest score, then larger area, then more lots.
 * Input should already be score-sorted for stable familyId (= best canonicalKey).
 */
export function groupIndexCandidateFamilies(
  members: IndexFamilyMember[],
  similarity = 0.55,
): IndexCandidateFamily[] {
  const sorted = [...members].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aa = a.siteAreaSqm ?? 0;
    const ba = b.siteAreaSqm ?? 0;
    if (ba !== aa) return ba - aa;
    return (b.lotCount ?? 0) - (a.lotCount ?? 0) || a.canonicalKey.localeCompare(b.canonicalKey);
  });

  const used = new Set<string>();
  const families: IndexCandidateFamily[] = [];

  for (const c of sorted) {
    if (used.has(c.canonicalKey)) continue;
    const alts: IndexFamilyMember[] = [];
    used.add(c.canonicalKey);
    for (const other of sorted) {
      if (used.has(other.canonicalKey)) continue;
      if (sameIndexFamily(c.parcelIds, other.parcelIds, similarity)) {
        alts.push(other);
        used.add(other.canonicalKey);
      }
    }
    const all = [c, ...alts].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aa = a.siteAreaSqm ?? 0;
      const ba = b.siteAreaSqm ?? 0;
      if (ba !== aa) return ba - aa;
      return (b.lotCount ?? 0) - (a.lotCount ?? 0) || a.canonicalKey.localeCompare(b.canonicalKey);
    });
    const best = all[0]!;
    families.push({
      familyId: `family:${best.canonicalKey}`,
      best,
      alternatives: all.slice(1),
    });
  }

  return families.sort((a, b) => {
    if (b.best.score !== a.best.score) return b.best.score - a.best.score;
    return (b.best.siteAreaSqm ?? 0) - (a.best.siteAreaSqm ?? 0);
  });
}

/** Collapse to one best member per family (Today). */
export function pickBestPerIndexFamily<T extends IndexFamilyMember>(
  members: T[],
  similarity = 0.55,
): T[] {
  const families = groupIndexCandidateFamilies(members, similarity);
  const byKey = new Map(members.map((m) => [m.canonicalKey, m]));
  return families
    .map((f) => byKey.get(f.best.canonicalKey))
    .filter((m): m is T => !!m);
}
