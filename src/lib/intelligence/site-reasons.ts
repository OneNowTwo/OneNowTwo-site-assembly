/** Plain-language Today reasons (also rewrites older engineering-ish stored hints). */
export function humanizeSiteReason(raw: string): string {
  const s = raw.trim();
  const uplift = s.match(/^NEW PROPOSED DENSITY UPLIFT\s*·\s*(.+)$/i);
  if (uplift) return `Proposed FSR uplift: ${uplift[1]}`;
  const station = s.match(/^STATION PROXIMITY\s*·\s*(\d+)\s*m$/i);
  if (station) return `About ${station[1]}m to a station`;
  const keySite = s.match(/^KEY SITE\s*·\s*(.+)$/i);
  if (keySite) return `Key site · ${keySite[1]}`;
  return s;
}
