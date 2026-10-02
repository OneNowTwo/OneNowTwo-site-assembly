export const OPPORTUNITY_STATUSES = ["WATCHING", "ANALYSING", "FEASIBLE", "ACQUIRING", "CONTROLLED", "REJECTED", "HOLD"] as const;
export type OpportunityStatusValue = (typeof OPPORTUNITY_STATUSES)[number];

export const ACQUISITION_STAGES = [
  "NOT_RESEARCHED",
  "OWNER_IDENTIFIED",
  "READY_TO_APPROACH",
  "LETTER_SENT",
  "DOOR_KNOCKED",
  "CONTACT_MADE",
  "INTERESTED",
  "PRICE_DISCUSSED",
  "OFFER_PREPARED",
  "OFFER_MADE",
  "NEGOTIATING",
  "OPTION_CONTRACT",
  "CONTROLLED",
  "DECLINED",
  "HOLD",
] as const;
export type AcquisitionStageValue = (typeof ACQUISITION_STAGES)[number];

export const STAGE_LABELS: Record<AcquisitionStageValue, string> = {
  NOT_RESEARCHED: "Not researched",
  OWNER_IDENTIFIED: "Owner identified",
  READY_TO_APPROACH: "Ready to approach",
  LETTER_SENT: "Letter sent",
  DOOR_KNOCKED: "Door knocked",
  CONTACT_MADE: "Contact made",
  INTERESTED: "Interested",
  PRICE_DISCUSSED: "Price discussed",
  OFFER_PREPARED: "Offer prepared",
  OFFER_MADE: "Offer made",
  NEGOTIATING: "Negotiating",
  OPTION_CONTRACT: "Option / contract",
  CONTROLLED: "Controlled",
  DECLINED: "Declined",
  HOLD: "Hold",
};

/** Progress weight per stage for the acquisition progress bar (0 = untouched, 1 = controlled). */
export const STAGE_PROGRESS: Record<AcquisitionStageValue, number> = {
  NOT_RESEARCHED: 0,
  OWNER_IDENTIFIED: 0.08,
  READY_TO_APPROACH: 0.12,
  LETTER_SENT: 0.2,
  DOOR_KNOCKED: 0.22,
  CONTACT_MADE: 0.3,
  INTERESTED: 0.4,
  PRICE_DISCUSSED: 0.5,
  OFFER_PREPARED: 0.55,
  OFFER_MADE: 0.65,
  NEGOTIATING: 0.75,
  OPTION_CONTRACT: 0.9,
  CONTROLLED: 1,
  DECLINED: 0,
  HOLD: 0,
};

export const ACTIVITY_TYPES = ["NOTE", "LETTER", "DOOR_KNOCK", "CALL", "EMAIL", "MEETING", "OFFER", "STAGE_CHANGE"] as const;

export const OWNER_TYPES = ["Owner-occupier", "Investor", "Company", "Estate / deceased", "Strata (owners corporation)", "Government", "Unknown"] as const;

export const DISCLAIMER =
  "Indicative development analysis only. Planning controls must be confirmed by a qualified planner and relevant consent authority before acquisition or development decisions are made.";
