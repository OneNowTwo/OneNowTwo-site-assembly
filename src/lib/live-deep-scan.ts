/**
 * Temporary gate: synchronous /api/scan must not run on the primary web instance.
 * Enable only when an isolated scan worker is live:
 *   LIVE_DEEP_SCAN_ENABLED=true (API)
 *   NEXT_PUBLIC_LIVE_DEEP_SCAN_ENABLED=true (Map button)
 */
export function isLiveDeepScanEnabled(): boolean {
  return (
    process.env.LIVE_DEEP_SCAN_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_LIVE_DEEP_SCAN_ENABLED === "true"
  );
}

export const LIVE_DEEP_SCAN_DISABLED_MESSAGE =
  "Live deep scan temporarily unavailable — indexed Today / Find / Map still work. Heavy scan is being moved off the web service.";

export const LIVE_DEEP_SCAN_DISABLED_BUTTON = "Live deep scan temporarily unavailable";
