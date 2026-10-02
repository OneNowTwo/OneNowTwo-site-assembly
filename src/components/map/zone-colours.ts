/** Approximation of NSW Standard Instrument LEP zone colours, for parcel fills. */
export function zoneColour(zone: string | null | undefined): string {
  if (!zone) return "#c9ced6";
  if (zone === "R1") return "#f7b6b6";
  if (zone === "R2") return "#fcd9d9";
  if (zone === "R3") return "#f6a4a4";
  if (zone === "R4") return "#ec7f7f";
  if (zone === "R5") return "#fde8e8";
  if (/^(MU|B4)/.test(zone)) return "#c9a8e0";
  if (/^(E1|E2|B\d)/.test(zone)) return "#a9c0f0";
  if (/^(E3|E4|E5|IN)/.test(zone)) return "#d9c3f0";
  if (/^RE/.test(zone)) return "#9ccf9c";
  if (/^SP/.test(zone)) return "#f5f0a0";
  if (/^C\d/.test(zone)) return "#b9dcb0";
  if (/^W/.test(zone)) return "#a8d4ea";
  return "#d8dbe0";
}
