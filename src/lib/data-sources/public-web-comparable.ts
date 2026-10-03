/**
 * OPTIONAL enrichment — not the foundation for MVP valuations.
 *
 * Intended later use: fetch factual attributes (beds/baths/parking/land size)
 * from publicly accessible agency sold pages where automated access is permitted.
 *
 * Hard rules:
 * - Respect robots.txt, site terms, and rate limits
 * - Do NOT scrape realestate.com.au, Domain, CoreLogic, or PropTrack without a licence
 * - Do not copy copyrighted descriptions or imagery
 * - Use only to improve comparable matching — NSW registered sales remain primary
 */
export class PublicWebComparableProvider {
  readonly name = "Public web comparable enrichment (disabled)";

  async enrich(input: {
    address?: string | null;
    suburb?: string | null;
    nearbyAddresses?: string[];
  }): Promise<{
    enabled: boolean;
    attributes: Record<string, never>;
    note: string;
  }> {
    void input;
    return {
      enabled: false,
      attributes: {},
      note:
        "PublicWebComparableProvider is a stub. Enable only for sites that permit automated access; never scrape REA/Domain/CoreLogic/PropTrack without authorisation.",
    };
  }
}

export const publicWebComparableProvider = new PublicWebComparableProvider();
