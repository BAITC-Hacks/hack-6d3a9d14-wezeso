# Blob characters

Every employee gets a deterministic character from their employee ID. Accounts without an employee profile (including HR) use their account ID. Color, shape, name and markings are reconstructed from that identity, so they stay consistent across reloads, devices, the sidebar, team roster and employee dialog. No browser storage or database migration is required.

Appearance uses eight two-tone palettes, eight silhouettes, four eye expressions and four marking styles (freckles, a spark, stripes or a constellation). Each trait has an independently mixed identity seed, with additional tone and marking variations. The employee demo account has a violet cloud with constellation markings. Unidentified visitor blobs also receive a generated appearance instead of falling back to the brand's green.

The character card appears on the personal route and team home. It shows the owner's level, XP and current or suggested quest. Each completed historical activity or HR-confirmed personal request earns 100 XP; every 500 XP adds a character level. Pending, rejected and other employees' requests award no XP. Character levels do not alter job grades or skill calculations.

Animated blobs use the existing bloub engine's `setLook` to follow mouse and pen movement across the viewport. Direction is bounded, smoothly interpolated and recalculated after layout changes. Leaving the window or switching to touch restores the idle gaze. Reduced-motion users get a still frame. Roster thumbnails are static; offscreen characters stop sampling animation frames.

Verification:

- `npm test`: character identity, distinct appearances for all 200 seeded employees, XP isolation, exact level thresholds and duplicate records; existing backend tests.
- `npm run build`: production build and TypeScript checks.
- Browser: left/right eye tracking, reload persistence, employee/colleague/manager/HR account switching, roster/dialog identity, quest navigation and 390px mobile layout.

Character rules live in `frontend/lib/character.ts`; rendering and pointer handling live in `frontend/components/Avatar.tsx` and `CharacterCard.tsx`.
