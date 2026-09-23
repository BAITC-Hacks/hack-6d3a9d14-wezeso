# Halyk Tech — Design Specification

Version 1.0 · 23 September 2026 · Companion: [rules.md](rules.md)

## 1. Scope and evidence

A proposed flat, technical design system for Halyk Bank Kazakhstan, grounded in its public retail website. This is an implementation specification, not an official Halyk brand book. No private brand guidelines, mobile-app source files, or complete ecosystem asset library were available. Observations describe the inspected website; proposed values define this adaptation.

### Verified reference details

Inspected the [Halyk retail homepage](https://halykbank.kz/ru), its rendered desktop layout, computed element styles, and accessible font-face declarations on 23 September 2026.

| Element | Observed website implementation | Treatment in this design |
| --- | --- | --- |
| Typeface | Manrope; Helvetica Neue, Helvetica, Arial, sans-serif fallbacks | Retain Manrope throughout |
| Font files | ExtraLight 200, Light 300, Regular 400, Medium 500, SemiBold 600, Bold 700; ExtraBold file also declared as `bold` | Use verified 400/500/600/700; do not copy the ambiguous ExtraBold mapping |
| Body | 16px, weight 500 in the inspected desktop state | 16px/24px, 400 for prose; 500 for controls |
| Utility navigation | 14px, weight 500 | Retain compact typography |
| Hero headings | 56px, weight 700 in the inspected desktop state | Restrict 56px to large marketing pages |
| Brand/action green | RGB 0, 128, 95: `#00805F` | Primary brand and action color |
| Pale mint | RGB 231, 248, 243: `#E7F8F3` | Selected and brand-tinted surfaces |
| Bright green hero CTA | RGB 100, 249, 149: `#64F995` | Limited flat accent with dark text |
| Amber carousel indicator | RGB 250, 174, 23: `#FAAE17` | Optional accent, never the sole status cue |
| Neutral surfaces | White; input background `#F1F2F6` | Retain white and light gray foundation |
| Secondary navigation text | `#6F6F6F` | Retain for secondary text on white |
| Shape | Observed 5px navigation, 10px CTA and 12px input radii; visibly larger rounded hero/panels | Replace with consistent 0–4px geometry |
| Structure | Two navigation rows, large promotional hero, exchange rates, product cards, calculator, app promotion, search, footer | Retain useful hierarchy; make data and tasks more prominent |
| Imagery and depth | Photo compositions, green tonal gradients, rounded promotional panels, header shadow, carousel controls | Replace with flat SVG diagrams, solid surfaces, borders and static content |

Source assets and stylesheet references:

- [Halyk font declarations](https://halykbank.kz/themes/halyk/assets/static/css/fonts.css?ver=2)
- [Halyk application stylesheet](https://halykbank.kz/themes/halyk/assets/css/app.css) — the inspected page used a versioned query string; values above were obtained from computed styles.
- [Manrope stylesheet referenced by Halyk](https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap)
- [Logo asset referenced by the inspected header](https://halykbank.kz/storage/app/uploads/public/6a5/75a/f7a/6a575af7a9880610279451.svg)
- [White logo asset referenced by the page](https://halykbank.kz/themes/halyk/assets/images/logo-w.svg)

Asset URLs are reference locations, not bundled deliverables or a guarantee of redistribution rights. The logo assets were identified from page markup; no official logo construction or clear-space manual was available. Only the green header logo was visually inspected.

## 2. Design direction

**Recognizably Halyk, expressed through precise typography, useful information, and a disciplined grid. Everything is flat. Nothing animates.**

Keep the official logo, Manrope, green identity, light surfaces and clear financial information. Achieve the technical character through aligned columns, rectangular controls, concise labels, visible units, status text and restrained diagrams. Avoid futuristic decoration, terminal aesthetics, neon glow and ornamental code fragments.

All dimensions and tokens below are proposed implementation decisions unless identified above as observed.

## 3. Color system

| Token | Value | Role |
| --- | --- | --- |
| `brand` | `#00805F` | Primary button, active navigation, links |
| `brand-hover` | `#006B50` | Instant hover fill |
| `brand-pressed` | `#00543F` | Instant pressed fill |
| `brand-soft` | `#E7F8F3` | Selected surface, quiet highlight |
| `brand-accent` | `#64F995` | Small accent areas; dark foreground only |
| `brand-amber` | `#FAAE17` | Optional emphasis; dark foreground only |
| `canvas` | `#FFFFFF` | Page canvas |
| `surface` | `#FFFFFF` | Panels and overlays |
| `surface-subtle` | `#F1F2F6` | Table headers, secondary areas |
| `text` | `#172B25` | Main text and numeric values |
| `text-secondary` | `#6F6F6F` | Supporting text on white |
| `border` | `#D7E0DC` | Decorative dividers and panel edges |
| `control-border` | `#74877F` | Form boundaries requiring clear visibility |
| `focus` | `#00543F` | Keyboard focus outline on light backgrounds |
| `success` / `success-bg` | `#006B50` / `#E7F8F3` | Confirmed success |
| `warning` / `warning-bg` | `#805600` / `#FFF4D6` | Caution requiring attention |
| `danger` / `danger-bg` | `#B42318` / `#FFF0EE` | Errors and destructive actions |
| `info` / `info-bg` | `#175CD3` / `#EEF4FF` | Informational messages |
| `disabled-text` / `disabled-bg` | `#68776F` / `#EDF0EE` | Disabled controls with explicit disabled semantics |

Use mostly white and neutral surfaces; reserve green for identity and meaningful actions. Suggested visual balance: 80% neutral, 15% green/tints, up to 5% accents. This is composition guidance, not a measured Halyk ratio.

Use white text on `brand`; dark `text` on bright green and amber. Never use pale borders as essential form boundaries. Verify final text pairs at 4.5:1 for normal text, 3:1 for large text, and essential controls/graphics at 3:1 against adjacent colors. Changing opacity or background requires a new check. Color must always have a text, icon, pattern or position counterpart.

Only the light theme is specified. Do not generate an automatic dark theme by inverting these colors.

## 4. Typography

```css
:root {
  --font-ui: "Manrope", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
body { font-family: var(--font-ui); font-size: 1rem; line-height: 1.5; }
button, input, select, textarea { font: inherit; }
.numeric { font-variant-numeric: tabular-nums lining-nums; }
```

Use Manrope for headings, body, navigation, controls, charts and numeric data. A technical appearance does not justify replacing the Halyk typeface with Inter, Roboto, a monospace family or a display font.

| Role | Desktop size / line height | Mobile size / line height | Weight |
| --- | --- | --- | --- |
| Marketing display | 56 / 64px | 36 / 44px | 700 |
| Page title | 40 / 48px | 28 / 36px | 700 |
| Section heading | 28 / 36px | 24 / 32px | 700 |
| Panel heading | 20 / 28px | 20 / 28px | 600 |
| Main metric | 32 / 40px | 28 / 36px | 700 |
| Body | 16 / 24px | 16 / 24px | 400 |
| Body emphasis / control | 16 / 24px | 16 / 24px | 500 or 600 |
| Table / compact navigation | 14 / 20px | 14 / 20px | 500 |
| Supporting metadata | 12 / 16px | 12 / 16px | 500 |

Use rem equivalents in implementation. Letter spacing: -0.02em on display/page titles, -0.01em on section headings, 0 elsewhere. Sentence case is the default. Do not set paragraphs or navigation in all caps. Keep reading lines around 60–75 characters and headings naturally wrapped.

Load local, appropriately licensed WOFF2 files for 400/500/600/700, declare each weight correctly, use `font-display: swap`, and avoid synthetic bold. Do not hotlink production font files from the bank's website. Preserve font license notices with the actual assets. Preload only an immediately needed face.

Check real font coverage for English, Russian, Kazakh and `₸`: `Ә ә Ғ ғ Қ қ Ң ң Ө ө Ұ ұ Ү ү Һ һ І і`. Also test `0–9`, decimal separators, percent signs and nonbreaking spaces. CSS family declarations alone do not prove every glyph renders in Manrope. If a supplied subset lacks glyphs, replace it with a complete licensed Manrope build; fallback fonts are a temporary technical fallback, not design approval.

## 5. Logo and brand assets

- Use the supplied official Halyk SVG lockup. Do not recreate the wordmark with typed Manrope or redraw the symbol.
- Preserve intrinsic proportions, official colors and artwork. Do not add outlines, shadows, gradients, glow, rotation or skew.
- Proposed placement: 144px-wide lockup on desktop, 112px on mobile, height automatic. Check legibility using the actual SVG; these are project sizes, not official minimums.
- Proposed clear space: at least half the symbol height on each side. An official brand guide supersedes this provisional spacing.
- Use the verified green lockup on white. Any inverse or monochrome variant must be supplied as an approved asset and visually checked before use.
- Logo links have an accessible name such as “Halyk home”; decorative duplicate marks use empty alternative text.

## 6. Grid, spacing and geometry

| Property | Specification |
| --- | --- |
| Base spacing unit | 4px |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48, 64, 96px |
| Maximum content width | 1280px, centered |
| Desktop ≥1200px | 12 columns; 24px gutters; minimum 32px page padding |
| Tablet 768–1199px | 8 columns; 24px gutters; 24px page padding |
| Mobile <768px | 4 columns; 16px gutters and page padding |
| Standard panel padding | 24px desktop; 16px mobile |
| Section separation | 64px desktop; 40px mobile |
| Content block gap | 24px; 16px for closely related blocks |
| Standard border | 1px solid |
| Active indicator | 2px solid |
| Radius | 0px structural surfaces; 4px controls and panels |
| Focus ring | 2px solid with 2px offset |

No pill buttons or oversized rounded cards. Circles are reserved for semantic shapes such as radio controls and chart markers, and for the unmodified official logo. Flatness means no simulated depth; functional overlays may still use z-index.

Marketing layout: compact navigation → static proposition and one primary CTA → product grid → useful data/calculator → supporting information → footer. Application layout: 64px header → optional 240px sidebar at ≥1200px → page heading and actions → metric row → working area/table. Mobile navigation opens instantly in an opaque bordered panel with no slide-in effect.

Use 3-column product grids on wide screens, 2 columns on tablet and 1 on mobile. Let long Russian and Kazakh labels wrap. No clipped buttons or fixed-height text panels. Do not force dashboard layouts into marketing pages.

## 7. Components

| Component | Structure and appearance | States and behavior |
| --- | --- | --- |
| Primary button | 44px minimum height, 20px horizontal padding, 4px radius, green fill, white 600 text | Hover/pressed change fill instantly; pending shows static “Processing…” text |
| Secondary button | White fill, control border, main text; same sizing | Instant pale-mint hover; no elevation |
| Text link | Green, underlined in prose; 44px hit area where used as a standalone control | Visible focus; no animated underline |
| Icon button | 44×44px hit area, 20px icon, accessible label | Same clear hover/focus/disabled states |
| Text field / select | Visible label, 48px minimum height, 12px horizontal padding, white fill, 1px control border | Error uses danger border plus explanatory text; placeholder never replaces label |
| Textarea | Same field treatment; minimum 120px; resize vertically | Preserve entered text on error |
| Checkbox / radio | 20px visual control within 44px hit target | Solid checked mark; instant state change; native semantics |
| Switch | Prefer a labeled checkbox or rectangular On/Off control | If a switch is needed, update instantly; no sliding thumb |
| Tabs | 44px targets; 2px green active underline and 600 active label | Keyboard support; panel replacement is instant |
| Panel / card | Solid white, 1px border, 4px radius, 24/16px padding | Clickable panels show immediate border/fill change; never lift |
| Metric panel | Label → value and unit → explanation/timestamp | Tabular numbers; no count-up effect or flashing updates |
| Table | 44px minimum rows, 48px header, 12×16px cell padding, horizontal dividers | Left-align labels; right-align numbers; explicit sort button and selected row marker |
| Status badge | 12/16px, 500; 4×8px padding; 4px radius | Text plus optional 12px icon; no pulsing dot |
| Alert | Solid status tint, 1px border, icon, title, message, optional action | Errors remain until resolved/dismissed; no auto-fading |
| Dialog | Opaque white panel, visible border, 4px radius, max 560px, mobile 16px margins | Instant appearance; focus trap, Escape when appropriate, return focus on close |
| Dialog backdrop | Static uniform translucent black, e.g. rgba(0,0,0,.40) | The only overlay tint; no blur, texture or fade |
| Tooltip | Solid dark background, white text, 4px radius | Immediate on focus/hover; essential instructions also appear inline |
| Accordion | Heading button and chevron; divider between sections | Instant show/hide; icon swaps orientation without animation |
| Pagination | Labeled previous/next; current page visibly selected | Explicit navigation; no auto-scrolling feed |
| Search | Persistent label or accessible name, leading 20px search icon, clear action | Static pending indicator; visible no-results message |
| Calculator | Labeled numeric fields, visible units, separate results panel | Recompute directly; no animated slider fill or rolling totals |

Keep one primary action per task area. Use semantic HTML before custom controls. Disabled, focused, invalid, selected and pending states must be distinguishable without motion.

## 8. Icons, illustrations and charts

Use one consistent SVG outline icon set: 24×24 viewBox, usually rendered at 20 or 24px, 1.5–2px stroke. Use solid semantic icons where recognition benefits. Do not reproduce Halyk's proprietary icon font as a text font; its presence on the source site is not a requirement to reuse it.

Illustrations must be flat vectors with solid fills and crisp edges. Prefer a simple payment diagram, labeled process, card outline or product symbol. No photographs with artificial depth, glossy mockups, floating phones, 3D coins, gradients, grain, glass, bevels or shadows. Product screenshots are allowed only when essential and themselves compliant with this flat visual system.

Charts use solid strokes, direct labels, subtle horizontal grid lines and no gradient area fills. Default palette: green `#00805F`, blue `#175CD3`, amber-brown `#805600`, gray `#68776F`; distinguish series additionally through labels, dash patterns or markers. No 3D charts. Start bar charts at zero; label units and disclose nonzero line-chart axes. Include an accessible data table or text equivalent. Tooltips and data updates appear instantly, with no morphing or drawing effect.

## 9. Content and localization

Use short, specific action labels: “View transactions”, “Download statement”, “Calculate payment”. Explain conditions beside the relevant value, not only in a distant footer. Do not invent financial claims, rates or eligibility. Mark prototype data as sample data.

Format currency and dates for the chosen locale; keep amounts and currency symbols together, use consistent decimal precision, and show a timestamp on time-sensitive data. Use `Intl.NumberFormat` and `Intl.DateTimeFormat` instead of hardcoded separators. Do not animate exchange rates or balances when they change.

Set the page language correctly (`kk`, `ru`, or `en`), translate controls and errors consistently, and leave room for longer translations. Use full labels instead of unexplained abbreviations. Essential instructions and disclosures remain at least 14px; 12px is reserved for nonessential metadata.

## 10. Accessibility and responsive behavior

Use logical landmarks and heading order, visible labels, keyboard operation, a skip link and visible focus. Use at least 44×44px touch targets for primary interactive controls. Ensure focus indicators contrast with each actual background; use a white outline on dark green surfaces where needed.

Support 200% text zoom and reflow at 320 CSS pixels. Wide data tables may scroll horizontally inside a labeled region with a visible affordance; the whole page must not overflow. Preserve primary actions and meaningful column headers. Do not hide essential financial information to fit mobile.

Provide static loading, empty, error, success, disabled, offline and stale-data presentations. Keep layout space reserved while content loads. Screen-reader live regions announce meaningful status changes without repeatedly announcing every data refresh.

## 11. Motion and depth contract

Animation and transitions are prohibited in every theme, breakpoint and state. This is unconditional, not just a reduced-motion preference. No CSS keyframes, transitions, JavaScript animation, smooth scrolling, parallax, autoplay, carousels, marquee, blinking application indicators, animated SVG, Lottie, GIF/APNG/WebP animation, video decoration, skeleton shimmer or spinning loaders.

Replace loading motion with static text and an optional static progress bar that updates directly when real progress changes. Navigation, dialogs, tabs, hover and validation update immediately. Browser-native text carets and direct user scrolling are platform behavior; do not add custom motion or disable basic editing to suppress them.

No box/text/drop shadows, gradients, backdrop blur, translucent glass surfaces, perspective, embossing or simulated elevation. Use solid fills, borders, spacing and typography for hierarchy. See [rules.md](rules.md) for enforcement and acceptance criteria.
