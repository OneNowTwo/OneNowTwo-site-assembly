/**
 * Registers adapter-owned live point enrichers.
 * Imported once from resolve-proposed-at-point (side effect).
 * Find / Map / Site never import council adapters directly.
 */

import { pointInBBox } from "../geometry";
import { registerLiveProposedPointEnricher } from "../live-point-enrichers";
import {
  IW_EXPERIENCE_URL,
  queryInnerWestProposedAtPoint,
} from "./inner-west-live";

/** Adapter-local envelope for live FeatureServer point queries — not used by Find. */
const IW_LIVE_ENVELOPE = { west: 151.12, south: -33.925, east: 151.2, north: -33.87 };

registerLiveProposedPointEnricher({
  sourceId: "live-inner-west-fairer-future",
  sourceUrl: IW_EXPERIENCE_URL,
  applies(lng, lat) {
    return pointInBBox(lng, lat, IW_LIVE_ENVELOPE);
  },
  async enrich(lng, lat) {
    const live = await queryInnerWestProposedAtPoint(lng, lat);
    const fsr = live.incentiveFsr ?? live.fsr;
    const height = live.incentiveHeightM ?? live.heightM;
    if (fsr == null && height == null && !live.keySiteId && !live.zone) return null;
    return {
      proposedZone: live.zone,
      proposedFsr: fsr,
      proposedHeight: height,
      keySiteId: live.keySiteId,
      planningChangeStatus: "PROPOSED",
      sourceUrl: IW_EXPERIENCE_URL,
    };
  },
});
