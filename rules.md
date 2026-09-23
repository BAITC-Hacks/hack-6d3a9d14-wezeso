# Halyk Tech — Mandatory Design and Implementation Rules

Version 1.0 · 23 September 2026 · Companion: [design.md](design.md)

## 1. Authority and intent

Build a Halyk-inspired technical interface using the verified Manrope font family and Halyk green identity. This document defines mandatory project rules; `design.md` defines tokens, component specifications, source evidence and proposed adaptations. Neither file is an official Halyk brand manual.

Priority: the user's explicit requirements → these rules → the design specification → framework defaults. Existing Halyk website effects are reference observations, not exceptions. **NO ANIMATIONS. EVERYTHING MUST BE FLAT.**

## 2. Non-negotiable motion rules

1. MUST NOT use CSS animations, `@keyframes`, transitions or motion-path effects.
2. MUST NOT use animation libraries, Web Animations API, requestAnimationFrame-driven visual interpolation, animated canvas or time-driven SVG effects.
3. MUST NOT animate opacity, color, position, size, layout, numbers, icons, charts or route changes.
4. MUST NOT use smooth scrolling, parallax, scroll reveals, page transitions, automatic scrolling, carousels or auto-advancing content.
5. MUST NOT use animated GIF, APNG, WebP, Lottie, animated SVG, decorative video or animated backgrounds.
6. MUST NOT use spinners, pulsing badges, blinking application indicators, typing simulations or shimmering skeletons.
7. MUST update hover, focus, pressed, selected, expanded, invalid and loading states immediately. Interaction feedback is required; interpolation is prohibited.
8. MUST use static “Loading…”, “Processing…” or meaningful progress text. A real progress bar may change value instantly; it must never move on a timer to imply fake progress.
9. MUST apply these rules regardless of `prefers-reduced-motion`. A reduced-motion-only override is insufficient.
10. MUST audit third-party widgets and chart libraries. Disable their motion in their own configuration; replace components whose motion cannot be removed.

Direct user scrolling, typing and browser-native carets are normal platform behavior. Preserve them. A functional slider may follow direct user input without inertia, smoothing or animated settling.

## 3. Non-negotiable flatness rules

1. MUST use solid color surfaces and crisp borders.
2. MUST NOT use box shadows, text shadows, drop shadows, glows, gradients, backdrop blur, glassmorphism, neumorphism, bevels, embossing, perspective or 3D transformations.
3. MUST NOT bake forbidden effects into images or SVGs. Flat CSS around a shaded 3D illustration is not compliant.
4. MUST NOT lift, scale, tilt or move a component on hover or press.
5. MUST use 0px radius for structural areas and no more than 4px for panels/controls. Semantic circles and original logo geometry are permitted.
6. MUST separate sections using spacing, dividers, labels or solid fills, never simulated elevation.
7. MAY use z-index for menus/dialogs and a static uniform modal backdrop. Overlay panels remain opaque and shadow-free; the backdrop has no blur or transition.

## 4. Brand and typography rules

- MUST use Manrope for all normal interface text, headings and financial data, with the fallback stack in `design.md`.
- MUST use actual font files for weights 400, 500, 600 and 700. Do not synthesize bold, or infer the weight of an ExtraBold asset from the source site's ambiguous CSS mapping.
- MUST NOT substitute Inter, Roboto, a monospace font or a futuristic display face for aesthetic reasons.
- MUST verify Kazakh, Russian, Latin, numeric and tenge glyph coverage using the actual shipped font files.
- MUST keep applicable font licenses with assets and serve production fonts locally when available. Reference URLs are not permission to redistribute proprietary material.
- MUST use the official supplied Halyk logo asset without redrawing, stretching, recoloring or retyping the wordmark.
- MUST use `#00805F` as the primary brand/action green; use the specified semantic tokens instead of arbitrary new colors.
- MUST use dark text on `#64F995` and `#FAAE17`; do not use those bright colors for small text on white.
- MUST distinguish proposed project choices from verified Halyk observations whenever documenting the system.

## 5. Layout and component rules

- MUST use the grid, type scale, spacing, borders and component states defined in `design.md`.
- MUST prioritize readable content, aligned data, visible units and clear actions over decorative technical motifs.
- MUST use visible form labels; placeholders alone are insufficient.
- MUST provide default, hover, focus, pressed, disabled, pending and error states wherever relevant.
- MUST reserve space for pending content and preserve user input after validation failures.
- MUST use native buttons for actions and links for navigation. Custom controls must preserve their keyboard and assistive-technology semantics.
- MUST right-align comparable numeric columns and use tabular numerals. Keep currency and units explicit.
- MUST keep error messages beside their fields and explain a corrective action.
- MUST show selected items through more than color: a border, underline, checkmark or text cue.
- MUST use one primary action per task area; secondary actions must remain visibly subordinate.
- MUST use a static hero or product grid instead of a promotional carousel.
- MUST render charts instantly and provide labels plus an accessible equivalent.
- MUST keep mobile layouts usable at 320px and text readable at 200% zoom. Avoid clipping long translated labels.

## 6. Accessibility rules

- MUST meet the contrast targets in `design.md` for every actual foreground/background pair, including hover, disabled and tinted surfaces where applicable.
- MUST NOT rely on color alone for meaning.
- MUST provide a visible keyboard focus indicator and a logical focus order.
- MUST provide accessible names for icon-only actions and useful text alternatives for informative images.
- MUST use at least 44px touch targets for primary interactive controls.
- MUST manage dialog focus and restore it on close; hiding a dialog must not leave focus inside it.
- MUST keep essential information available without hover, animation or a pointer device.
- MUST announce meaningful asynchronous results with appropriate live regions; do not continuously announce fluctuating data.

## 7. CSS implementation baseline

The following is a defensive baseline, not a substitute for removing motion from component code. Scope it to the application if embedded into another product. Styles do not penetrate third-party iframes or closed shadow roots; those need separate configuration or replacement.

```css
:root {
  --font-ui: "Manrope", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --brand: #00805f;
  --brand-hover: #006b50;
  --brand-pressed: #00543f;
  --brand-soft: #e7f8f3;
  --brand-accent: #64f995;
  --brand-amber: #faae17;
  --canvas: #ffffff;
  --surface: #ffffff;
  --surface-subtle: #f1f2f6;
  --text: #172b25;
  --text-secondary: #6f6f6f;
  --border: #d7e0dc;
  --control-border: #74877f;
  --focus: #00543f;
  --success: #006b50;
  --success-bg: #e7f8f3;
  --warning: #805600;
  --warning-bg: #fff4d6;
  --danger: #b42318;
  --danger-bg: #fff0ee;
  --info: #175cd3;
  --info-bg: #eef4ff;
  --disabled-text: #68776f;
  --disabled-bg: #edf0ee;
  --radius: 4px;
  --motion-duration: 0ms;
}

*, *::before, *::after {
  box-sizing: border-box;
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
  box-shadow: none !important;
  text-shadow: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 1rem;
  line-height: 1.5;
  font-synthesis: none;
}

button, input, select, textarea { font: inherit; }

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}

.button-primary {
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--brand);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.button-primary:hover:not(:disabled) { background: var(--brand-hover); }
.button-primary:active:not(:disabled) { background: var(--brand-pressed); }
.button-primary:disabled {
  background: var(--disabled-bg);
  color: var(--disabled-text);
  cursor: not-allowed;
}
.numeric { font-variant-numeric: tabular-nums lining-nums; }

@media (max-width: 767px) {
  .panel { padding: 16px; }
}
```

No blanket `transform: none` is included: static transforms can position an overlay or orient an icon. Movement effects and 3D transforms remain prohibited. Do not use a global `background-image: none` that would erase functional assets; remove gradients explicitly during implementation and asset review.

Do not wait for `transitionend` or `animationend` to complete application logic. State changes, dismissal, focus management and cleanup must work when no animation runs. Set JavaScript scrolling to instant behavior and disable chart animation in library configuration.

## 8. Required review before delivery

- [ ] Manrope loads successfully at all required weights; glyph coverage is checked with actual text.
- [ ] Official logo proportions and colors are intact; no invented logo variant is used.
- [ ] All colors, spacing, radii and text roles map to the specification.
- [ ] No CSS/JS animation or transitions exist, including pseudo-elements, route changes and vendor components.
- [ ] No animated media, decorative video, animated SVG, shimmer, spinner, pulse or count-up remains.
- [ ] No gradients, shadows, blur, glow or 3D effects appear in CSS, SVG, raster assets or charts.
- [ ] Every control provides immediate and visible interaction feedback.
- [ ] Loading, empty, error, success, disabled and stale/offline states are designed.
- [ ] Text contrast and essential control boundaries have been checked against actual backgrounds.
- [ ] Keyboard navigation, focus, dialogs and form errors are usable.
- [ ] Screens at 320px, 768px and 1280px widths plus 200% text zoom are checked.
- [ ] Kazakh and Russian labels wrap correctly; currency, units and timestamps are clear.
- [ ] Tables retain meaningful headings and chart data has an accessible equivalent.
- [ ] No functional workflow depends on animation events.

Search implementation source for `@keyframes`, `animation`, `transition`, `animate(`, `requestAnimationFrame`, `behavior: "smooth"`, `gradient(`, `box-shadow`, `text-shadow`, `drop-shadow`, `backdrop-filter`, `perspective`, and animation utility classes. Review matches rather than blindly deleting them: documentation, resets and disabled library settings can be legitimate. Also inspect runtime computed styles and embedded assets; a source search alone cannot prove compliance.

These are acceptance criteria for a future implementation. This delivery contains specifications only; it does not claim a built interface has passed these checks.
