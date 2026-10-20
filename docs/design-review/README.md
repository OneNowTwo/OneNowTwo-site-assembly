# Development brief — direct implementation pass

This replaces the previous Today composition in draft PR #36. It does not merge or deploy production, change planning resolution, or incorporate #35.

## Implemented

- A deliberately composed page header, quiet utility search and focused strategy selector.
- Three linked summary metrics and a true master/detail workspace.
- Three readable site rows: address, lot count, area, location, current controls and a plain numeric score. Long reasoning is moved into the selected-site inspector.
- Editorial section headings, consistent typography, narrower colour palette and scoped CSS modules, independent of the shared Panel/Grid wrappers that caused the earlier layout failure.
- Real existing parcel map component, muted basemap/parcel styling, selected-site controls and clear analysis/map actions.
- Planning updates open an accessible native dialog with stored brief text, source link when supplied, and existing map/site links. This is a brief viewer; the richer evidence work remains in #35.
- Sidebar line icons and tighter navigation. No fake Settings or coverage links.
- Keyboard selection, focus states, native dialog focus management and mobile layout.

## Verification

- Existing tests: 42 files / 339 tests passed.
- Production build, including TypeScript and static generation: passed. A dummy local database URL was supplied for build-time module configuration; no production DB was connected.
- ESLint on the two changed TSX files: passed.
- Browser smoke: select another site; verify selected state; open and close planning update dialog; desktop, wide desktop, laptop and mobile viewports. No page errors; no document horizontal overflow at 390px.
- Screenshots in this directory are actual rendered components in an isolated local harness, NOT a live database/session or a production acceptance test. The temporary harness route was removed before build and is not committed.

## Screenshot data and limits

- Geometry and areas: existing checked-in `prisma/seed-data/neutral-bay-demo-parcels.json` (stored NSW snapshot dated 2 October 2026). Lot combinations are layout-test fixtures.
- Scores 82 / 74 / 69, summary counts and update rows are explicit test fixtures; they are not calculations or a current development recommendation. The screenshot contains a test-data label.
- Basemap tiles were blocked by the local verification environment. Parcel outlines render from the stored geometry. Basemap appearance and the actual authenticated API flow still require verification in the existing connected preview.
- Find, the full Map workspace, opportunity calculations, authentication and data ingestion were not redesigned in this pass.

## Preview handoff

Pull the latest `cursor/ui-preview-warm-stone-5380` branch and restart the existing preview. The changes use existing authenticated dashboard/map endpoints; no fixture data or public harness is shipped. Review `/dashboard` using the real workspace. Keep the PR draft and production unchanged.
