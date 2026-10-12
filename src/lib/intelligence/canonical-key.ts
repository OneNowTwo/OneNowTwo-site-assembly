/** Canonical identity for Today site cards: sorted included parcel IDs. */

export function canonicalParcelKey(parcelIds: string[]): string | null {
  const ids = [...new Set(parcelIds.map((p) => p.trim()).filter(Boolean))].sort();
  if (!ids.length) return null;
  return ids.join("|");
}

export function parseCanonicalParcelKey(key: string): string[] {
  if (!key || key.includes(":")) return [];
  return key.split("|").filter(Boolean);
}
