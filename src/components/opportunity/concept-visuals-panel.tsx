"use client";

import { Panel } from "@/components/ui";

/** Future-facing placeholder — do not distract from monitoring features. */
export function ConceptVisualsPanel() {
  return (
    <Panel title="Concept visuals">
      <p className="text-[12px] text-muted">
        Coming soon — indicative massing, before/after site concepts, developer presentation images, and simple concept video. Not available in this release.
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">
        <li>Indicative massing</li>
        <li>Before / after site concept</li>
        <li>Developer presentation image</li>
        <li>Simple concept video</li>
      </ul>
    </Panel>
  );
}
