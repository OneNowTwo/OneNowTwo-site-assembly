import { money, pct } from "@/lib/format";

export interface ApproachBriefInput {
  address: string;
  lotDp: string;
  role: string;
  criticalReasons: string[];
  marketValue: number | null;
  openingOffer: number;
  maximumOffer: number;
  ownerPremium: number | null;
  stageLabel: string;
  ownerName: string | null;
  keyNotes: string;
  assemblyName: string;
  lotCount: number;
}

const NEXT_ACTION: Record<string, string> = {
  "Not researched": "Confirm title details and owner identity (title search).",
  "Owner identified": "Prepare introductory letter; check owner occupancy.",
  "Ready to approach": "Send introductory letter and follow with a door knock within 7 days.",
  "Letter sent": "Door knock or call within 7–10 days of the letter.",
  "Door knocked": "Follow up with a call; leave contact details.",
  "Contact made": "Arrange a meeting to understand the owner's timing and price expectations.",
  "Interested": "Discuss indicative price range; do not exceed the opening offer.",
  "Price discussed": "Prepare written offer / option terms with your solicitor.",
  "Offer prepared": "Present offer in person; explain option structure and timing.",
  "Offer made": "Follow up; negotiate within maximum modelled offer.",
  "Negotiating": "Agree heads of terms; instruct solicitor on option deed / contract.",
  "Option / contract": "Track option conditions and exchange timeline.",
  "Controlled": "No action — lot controlled.",
  "Declined": "Record reasons; revisit in 6–12 months; test project without this lot.",
  "Hold": "Revisit when the core lots are secured.",
};

export function suggestedNextAction(stageLabel: string): string {
  return NEXT_ACTION[stageLabel] ?? "Review status.";
}

/** Plain-text internal approach brief. Template only — nothing is sent automatically. */
export function generateApproachBrief(i: ApproachBriefInput): string {
  return [
    `APPROACH BRIEF — ${i.address}`,
    `${i.lotDp} · ${i.assemblyName} (${i.lotCount} lots)`,
    "",
    `Role in assembly: ${i.role}`,
    ...i.criticalReasons.map((r) => `  • ${r}`),
    "",
    `Estimated market value:   ${money(i.marketValue)}`,
    `Opening offer:            ${money(i.openingOffer)}`,
    `Maximum modelled offer:   ${money(i.maximumOffer)}`,
    `Indicative owner premium: ${pct(i.ownerPremium, 0, true)} (opening offer vs estimated value)`,
    `Owner: ${i.ownerName ?? "Not yet identified"}`,
    `Current status: ${i.stageLabel}`,
    "",
    "Key notes:",
    i.keyNotes.trim() || "  —",
    "",
    `Suggested next action: ${suggestedNextAction(i.stageLabel)}`,
    "",
    "Indicative only — not a valuation or a binding offer. Do not disclose the maximum modelled offer.",
  ].join("\n");
}

export function generateOwnerLetter(i: { ownerName: string | null; address: string; contactDetails: string }): string {
  return [
    `Hi ${i.ownerName?.trim() || "[Owner]"},`,
    "",
    `I'm looking at acquiring several properties in this immediate area for a potential future development and wanted to see whether you would be open to discussing the sale of ${i.address}.`,
    "",
    `There is no obligation at this stage. If you are open to a conversation, please contact me on ${i.contactDetails.trim() || "[details]"}.`,
  ].join("\n");
}
