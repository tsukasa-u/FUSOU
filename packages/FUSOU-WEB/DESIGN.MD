# DESIGN.MD

Design System for FUSOU-Project

Data-dense naval analytics UI with a calm dark base, explicit status signaling, and fast operational clarity.

Design principles:

- Keep a dark technical canvas with restrained accents.
- Prioritize clear state communication and readable data surfaces.
- Maintain compact spacing with crisp interaction feedback.
- Reduce visual noise and keep action surfaces focused.

## Usage

Use this DESIGN.md as the default visual specification for UI work in FUSOU-Project.

- Ask your AI assistant to follow this file for all UI tasks.
- Prefer existing Tailwind + DaisyUI implementation patterns in this repository.
- Keep interaction labels explicit and action-oriented.
- Preserve existing page behavior unless explicitly requested.

Implementation contract for consistency:

- Reuse page primitives before writing page-specific wrappers.
- Prefer shared classes/components over one-off inline class stacks.
- When introducing a new UI pattern, define it once as a reusable primitive.

## 01 / COLOR PALETTE

### Brand

- FUSOU Accent Green: #3ecf8e (primary accent for main actions)
- Data Info Blue: #4ea8ff (data/help emphasis and non-critical info)
- Alert Amber: #f7b955 (warning and attention)
- Critical Red: #f25f5c (error and destructive action)
- Accent Border: rgba(62, 207, 142, 0.28) (high-priority bordered highlight)

### Neutral Scale

- Near Black: #0f0f0f (primary button background, deepest surface)
- Dark: #171717 (page background, primary canvas, oklch 21.6%)
- Dark Border: #303338 (section dividers, subtle separation)
- Border Dark: #3b3e44 (card, modal and tab borders, `--color-base-300: oklch(35% 0.008 286.033)`)
- Mid Border: #474b52 (button borders, interactive dividers, `color-mix 22-25%`)
- Border Light: #525760 (secondary borders, elevated outlines)
- Charcoal: #5f6570 (tertiary borders, dark accents)
- Dark Gray: #787d87 (heavy secondary text)
- Mid Gray: #8e8e8e (muted text, metadata)
- Light Gray: #b4b4b4 (secondary link text)
- Near White: #efefef (light border, subtle surface)
- Off White: #fafafa (primary text)

#### Dark Mode Contrast & Border Visibility Rules

- **Visibility Requirement**: In dark mode (`#171717` canvas), borders must maintain clear, discernible contrast against the background so that structural cards, tab headers, modals, and buttons do not dissolve into the canvas.
- **Base-300 Baseline**: DaisyUI `--color-base-300` is configured to `oklch(35% 0.008 286.033)` in dark mode (approx. `#3b3e44`), providing a reliable ~14% luminance delta over the `#171717` base.
- **Opacity Floor**: When using alpha modifiers with `border-base-300`, use `/75` to `/80` (e.g. `border-base-300/75`). Avoid low opacities like `/50` or `/60` in dark mode as they reduce luminance back to the invisible range.
- **Button & Input Outlines**: Use `color-mix(in oklch, var(--color-base-content) 22-25%, transparent)` for borders on interactive ghost/outline controls.

### Radix Color Tokens

- Success: hsl(151, 55%, 52%)
- Info: hsl(207, 92%, 64%)
- Warning: hsl(39, 92%, 62%)
- Error: hsl(2, 85%, 63%)
- Focus Ring: hsl(151, 55%, 52%)

### Surface and Overlay

- Glass Dark: rgba(41, 41, 41, 0.84)
- Slate Alpha: hsla(210, 88%, 16%, 0.04)
- Overlay Strong: rgba(12, 12, 12, 0.72)

## 02 / TYPOGRAPHY RULES

- Display Hero: 56px / weight 500 / line-height 1.05 / Inter, system-ui
- Section Heading: 28px / weight 600 / line-height 1.20 / Inter, system-ui
- Card Title: 20px / weight 600 / line-height 1.30 / Inter, system-ui
- Sub-heading: 16px / weight 600 / line-height 1.40 / Inter, system-ui
- Body: 14px / weight 400 / line-height 1.55 / Inter, system-ui
- Nav Link / Button: 13px / weight 500 / line-height 1.30 / Inter, system-ui
- Caption: 12px / weight 400-500 / line-height 1.40 / Inter, system-ui
- Small: 11px / weight 400 / line-height 1.35 / Inter, system-ui
- Code Label: 12px / weight 500 / line-height 1.33 / letter-spacing 0.8px / uppercase / ui-monospace

Rules:

- Prioritize numeric/table readability over decorative type scaling.
- Avoid oversized hero typography in analytics pages.

## 03 / BUTTON VARIANTS

- Primary: main CTA, solid accent with clear contrast
- Secondary: bordered action for common operations
- Ghost: low-emphasis action for reversible operations
- Destructive: outlined red variant for delete/reset flows

Rules:

- Use one primary action per panel/section.
- Keep button labels action-outcome based (for example: Load, Share, Delete, Apply).
- Group page-level actions by frequency: primary first, then secondary, then destructive.
- Disable unavailable actions explicitly instead of hiding when possible.

## 04 / CARDS AND CONTAINERS

### Standard Card

- Border: 1px solid #3b3e44 (`border-base-300/75`)
- Radius: 12px
- Background: #171717 (`bg-base-100`)
- Shadow: none

### Prominent Card

- Border: #474b52 (`border-base-300` full opacity) for stronger separation
- Radius: 12px
- Shadow: none

### Accent Card

- Border: rgba(62, 207, 142, 0.28)
- Radius: 12px
- Use only for high-priority highlights

### Container Widths (PageShell)

- **`container="default"`**: `max-w-[78rem]` (1248px outer, `76rem` / 1216px inner with `px-4`). Standard across all primary dashboards (Fleet Simulator, Battles, Quests, Parameter Trends / Ship Growth). Aligns precisely with the 3x2 fleet deck width in the simulator, eliminating excessive horizontal eye travel.
- **`container="medium"`**: `max-w-4xl` (896px). Used for portal & landing pages (Download, Contact).
- **`container="narrow"`**: `max-w-2xl` (672px). Used for forms, sign-in, and detail inspectors.
- **`container="compact"`**: `max-w-lg` (512px). Used for compact dialogs and small settings cards.
- **`container="wide"`**: `max-w-[1500px]`. Reserved for ultra-wide full-screen views if explicitly needed.

Rules:

- Default to Standard Card for data panels.
- Use Prominent Card only for workflow grouping.
- Use Accent Card sparingly (status highlights, callouts, onboarding hints).
- For all data-dense dashboards, always use `container="default"` (`max-w-[78rem]`) to maintain unified layout width and comfortable eye tracking.

## 05 / FORM ELEMENTS

- Inputs use dark surfaces with clear border contrast.
- Focus state must be visible with a single border/accent shift only.
- Do not use double focus affordances on text inputs, selects, textareas, or file inputs.
- Suppress default outline/ring combinations from DaisyUI or the browser when they create a double border effect.
- Error state must include both color and explanatory text.
- Labels and helper text should remain readable on dark backgrounds.
- Selects, tabs, and filters should share consistent control height within the same toolbar.
- Any async form action must show loading and post-action result feedback.

Mobile readability rules:

- On initial page composition, input-like controls must not receive focus automatically.
- When a modal opens, focus must stay on the dialog shell or trigger context, not jump into an input automatically.
- Never call `.focus()` on a modal search field by default unless the task explicitly requires immediate keyboard entry.
- Avoid opening the on-screen keyboard on coarse pointer devices as a side effect of layout or modal presentation.

## 05a / LINKS AND TEXT INTERACTIONS

- All inline links (both in markdown and HTML) use the DaisyUI color system: `--color-link`, `--color-link-hover`, `--color-link-visited`.
- Light mode: `#0b63ce` (saturated blue) for clear distinction from body text.
- Dark mode: `#7db4ff` (bright blue) for sufficient contrast against light text.
- Hover state: `--color-link-hover` darkens the color to indicate interactivity.
- Visited state: `--color-link-visited` (purple) indicates previously visited links.
- No underline decoration by default; use color difference alone to distinguish links from body text.
- Use `.link` class (with `.link-hover` for hover effects) for standalone link elements in HTML.
- Use markdown link syntax for links in markdown/documentation content; styling is automatically applied via `.markdown a` rules.

## 06 / SPACING SYSTEM

Base unit: 8px

Scale:

- 1px, 4px, 6px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 90px, 96px, 128px

Rules:

- Use 8px rhythm for most layout spacing.
- Use larger jumps (32/40/48+) for section separation.
- Keep compact density in data-heavy views.
- Use 12px/16px for table cell padding to preserve scan speed.

## 07 / BORDER RADIUS SCALE

- 6px: ghost buttons, small controls
- 8px: cards and standard containers
- 12px: mid-size panels
- 16px: modal shells and major callout panels
- 9999px: optional pill badges only (not default button shape)

## 08 / ELEVATION AND DEPTH

No default shadows. Depth is communicated primarily through border hierarchy.

- Level 0 (flat): border #3b3e44 (`border-base-300/75`)
- Level 1 (subtle): border #474b52 or #525760
- Level 2 (focus only): minimal focus shadow rgba(0, 0, 0, 0.12) 0px 4px 12px
- Level 3 (accent): green accent border rgba(62, 207, 142, 0.28)

Rules:

- Prefer border contrast over shadow stacking.
- Keep hover elevation subtle; avoid motion-heavy depth illusions.

## 09 / REUSABLE PRIMITIVES

Use these shared primitives to keep UI changes low-cost and consistent.

### Shared Components

- src/components/ui/PageShell.astro
  - Standard page frame (top offset, background, container width, vertical rhythm)
- src/components/ui/PageHeader.astro
  - Standard page title/subtitle/actions layout
- src/components/AlertBox.astro
  - Shared alert for Astro pages (info/success/warning/error)
- src/components/solid/common/AlertMessage.tsx
  - Shared alert for Solid panels (info/success/warning/error)

### Shared Utility Classes

- Layout
  - .fusou-page
  - .fusou-page-container
  - .fusou-page-header
  - .fusou-page-title / .fusou-page-title-compact
  - .fusou-page-subtitle / .fusou-page-subtitle-compact
  - .fusou-page-actions
- Surfaces
  - .fusou-card
  - .fusou-card-body
  - .fusou-footer-note
- Actions
  - .fusou-btn-primary
  - .fusou-btn-secondary
  - .fusou-btn-ghost

### Global Baseline

- Buttons, cards, modals, and table headers are normalized in src/assets/app.css.
- Input, select, textarea, and file-input focus styling is also normalized there to keep focus treatment single-line and mobile-safe.
- Prefer this baseline over page-local overrides unless behavior requires exceptions.

### Modal Focus Behavior Rules

- Opening a modal must not auto-focus an input field.
- The dialog container may receive focus for accessibility and keyboard escape handling, but text entry controls should wait for explicit user action.
- If a modal contains a search field, leave it unfocused on open and let the user tap or click into it.

### Alert and Status Message Rules

- Never handcraft one-off warning/info/error blocks when reusable alert components are available.
- Astro pages must use src/components/AlertBox.astro for status callouts.
- Solid components must use src/components/solid/common/AlertMessage.tsx for status callouts.
- Alert visual variants are defined centrally by `.alert.alert-info|success|warning|error` in src/assets/app.css.
- Alert content must include icon + message at minimum, and optional title only when needed.

### Tutorial Control Preview Rules

- In src/components/TutorialModal.astro, control preview chips must reuse real button variants:
  - `btn-primary` for primary controls
  - `btn-outline` for outline controls
  - `btn-ghost` for low-emphasis controls
- Do not define separate preview-only color palettes for these controls.
- Each preview row must vertically center-align the button and text (`items-center`).
- Adjacent description text should use compact line-height suitable for single-line labels.

### List Marker Rules (Scoped)

- For selected non-markdown explanatory lists, use hyphen markers instead of disc bullets.
- Use shared class `.fusou-hyphen-list` (defined in `src/assets/app.css`) rather than per-page one-off CSS.
- Current mandatory targets:
  - Home page guide lists (`src/components/Hero.astro`)
  - Contact page takedown information list (`src/pages/contact.astro`)
  - Tutorial step list inside modal (`src/components/TutorialModal.astro`)
- Do not force-convert lists that already communicate semantics with custom markers/icons (for example, checkmark status lists).
- Markdown article lists keep using existing `.markdown ul` hyphen rule and should not be restyled separately.

### Navigation and Header Action Border Rules

- Navigation buttons should not show border lines.
  - Enforced by `.navbar .btn { border-width: 0; border-color: transparent; }` in src/assets/app.css.
- Page header action buttons should also stay borderless under `.fusou-page-actions .btn`.
- If a specific button truly requires a border for semantics, document the exception in the page-level change summary.

### Reproduction Checklist (When Adding New UI)

- Add status messaging through AlertBox (Astro) or AlertMessage (Solid), not inline div stacks.
- Reuse `.btn` variants directly in tutorial control previews.
- Keep preview button/text rows vertically centered.
- Verify navigation/header action button borders remain disabled.
- Run at least file-level diagnostics on changed files before completion.

### Extension Rules

- New primitives must be added to shared layer first (component or utility class).
- Do not duplicate equivalent patterns with slightly different spacing/radius.
- If an exception is needed, document why in page comments or PR summary.

## Additional Links

- [Design System Guide](https://getdesign.md/)

## 10 / UI COMPONENT CHEAT SHEET & COMPOSITION RULES

Follow this reference checklist when building new pages, features, or panels in FUSOU-WEB.

### 1. Page Frame & Layout
- **Full-width data dashboards (battles, simulator, quests, ship-growth)**:
  Use `<PageShell container="default">` (`max-w-[78rem]`). Inner content width is bounded to `76rem` (1216px), aligning seamlessly with the 3x2 fleet deck layout so that headers, tabs, toolbars, and cards share identical margins without excessive wide-screen eye scanning:
  ```astro
  <Layout title="...">
    <Navigation filled={true} />
    <PageShell container="default" paddingY="8">
      <FusouPageHeader title="..." subtitle="..." />
      ...
    </PageShell>
  </Layout>
  ```
- **Narrow pages (forms, sign-in, settings, detail inspectors)**:
  Use `<PageShell container="narrow">` (max-w-2xl) or `<PageShell container="compact">` (max-w-lg).
- **Portal & Landing pages (home, download, contact)**:
  Use `<PageShell container="medium">` (max-w-4xl) to keep content focused while maintaining left-alignment with the title.
- **Documentation pages**:
  Always use `<DocsLayout title="..." headings={...}>` (do not handcraft 3-column grids).
- **Error states (404, 500, broken routes)**:
  Always use `<ErrorView code="..." title="..." message="..." />`.

### 2. Containers & Cards
- Always wrap standalone data sections in `.fusou-card` (`border-base-300/75`).
- For internal card padding, use `.fusou-card-body` or `p-4 sm:p-6`.
- For clickable or selectable cards, use `.fusou-card-interactive`. Never use ad-hoc `border border-base-300 bg-base-100`.

### 3. Action Buttons
- **Primary / Call to Action**: `.fusou-btn-primary` (navy-tinted dark button with prominent accent on hover)
- **Secondary / Sub Actions**: `.fusou-btn-secondary` (outlined with base-300 border)
- **Cancel / Close / Dismiss**: `.fusou-btn-ghost`
- **Destructive / Delete / Revoke**: `.fusou-btn-danger`
- **Data Tables & Compact Rows**: Use `.fusou-btn-xs-primary`, `.fusou-btn-xs-secondary`, `.fusou-btn-xs-ghost`. Avoid `btn-xs btn-outline` with arbitrary overrides.

### 4. Zero Data & Loading Feedback
- **Zero data / empty results**:
  `<EmptyState message="データがありません" [compact] />` (never write bare `<div>データなし</div>`).
- **Data loading**:
  `<LoadingState message="データを読み込んでいます..." [height="h-32"] />` (never write bare `<span>読込中...</span>`).
- **In-app alerts**:
  Use `<AlertBox type="..." />` (Astro) or `<AlertMessage type="..." />` (Solid).

### 5. Domain Specific Naval Primitives
Always reuse these dedicated primitives instead of hand-crafted text/color strings:
- **Ship Type**: `<ShipTypeBadge stype={ship.stype} [short] />`
- **Ship Speed**: `<SpeedBadge speed={ship.soku} />`
- **Ship Banner**: `<ShipBanner shipId={ship.id} [damaged] />`
- **Stats (Fire/Torp/AA/Armor)**: `<StatPill tone="fire" value={...} />`
- **Equip Improvement**: `<EquipLevelBadge level={equip.level} />` (renders `★+1` to `★max`)
- **Aircraft Proficiency**: `<AircraftProficiencyBadge alv={equip.alv} />` (renders `|`, `||`, `>>`)
- **Victory Rank**: `<VictoryRankBadge rank="S" />`
- **Air State**: `<AirStateBadge state="制空権確保" />`
- **Formation**: `<FormationBadge formation="単縦陣" />`
- **Map Selection Grid**: `<MapAreaGrid groups={...} onSelect={...} />`

### 6. Modal Dialogs
- Always wrap modal content in `<FusouModal title="..." maxWidth="..." actions={...}>`.
- Never write bare `<dialog class="modal"><div class="modal-box">...<form method="dialog">...`.

### 7. Filter & Selection Chips (ActiveFilterChips & SearchFilterBar)
- **Active Filter Visibility**:
  When data lists, modal pickers, or search dashboards support filtering (e.g. Map, Victory Rank, Ship Type, Equipment Type, Search keyword), always render active filter conditions in an explicit chips bar using `<ActiveFilterChips items={...} onClearAll={...} />`.
  - Never allow filters to be silently applied without prominent visual indication.
  - In tabbed dashboards, place the unified `<BattleSearchFilterBar />` on the right side of the tab toolbar, and place `<ActiveFilterChips />` directly below the toolbar to prevent horizontal crowding and tab truncation across intermediate screen widths.
- **Tab & Search/Filter Toolbar Pattern**:
  ```tsx
  <div class="fusou-tab-toolbar">
    <BattleTabs activeTab={activeTab()} onTabChange={...} />
    <BattleSearchFilterBar
      activeFilterCount={activeFilterItems().length}
      onOpenFilterModal={() => filterModalRef?.showModal()}
    />
  </div>

  <Show when={activeFilterItems().length > 0}>
    <div class="-mt-3 mb-4 px-0.5">
      <ActiveFilterChips items={activeFilterItems()} onClearAll={...} />
    </div>
  </Show>
  ```
- **Unified Search & Filter Trigger**:
  Combine search and filter triggers into a single button (`#battle-filter-settings-btn`) displaying:
  - Search icon + "検索・フィルター" text
  - Active count badge: `<span class="badge badge-primary badge-xs">{count}</span>` when count > 0
  - Shortcut key indicator: `<kbd>/</kbd>`
- **Chip Structure & Actions**:
  - Each chip item displays the filter label (`label`), current value (`value`), and an individual dismiss button (`✕`).
  - When 2 or more filters are active, render a "条件をすべてクリア" button (`onClearAll`) to clear all filters in a single click.
  - Comply with accessibility: `role="region"`, `aria-label="適用中のフィルター"`, and explicit `aria-label` / `title` on dismiss buttons.

### 8. Interactive Action Buttons & Badges (Micro-interactions & Hover Affordance)
When rendering interactive controls within cards, table rows, and slot items (e.g. Fleet Simulator ship/equip slots):
- **Terminology Rule**: Always use **「艦」** (ship) for naval character entities. Never use "艦娘" anywhere in the UI, code, tooltips, or documentation.
- **Component Reusability & Vertical Centering (`EquipSlotRow` & `EquipSlotControls`)**:
  - **Shared Slot Row Structure (`EquipSlotRow`)**: Both naval fleet ship equipment slots and Land-based Air Base (LBAS / 基地航空隊) squadron slots must use the identical `<EquipSlotRow>` wrapper.
  - **Uniform Row Height & Padding**: All equipment and airbase slot rows are strictly fixed to `h-7` (28px) with `px-2` padding. Never use ad-hoc `h-6` or `h-8` with divergent `py-0.5` or `py-1.5`.
  - **Consistent Label Metrics & Perfect Vertical Centering**:
    - Slot index/plane count: `w-4 text-center text-[10px] font-mono leading-none inline-flex items-center justify-center`.
    - Equipment name: `text-[11px] leading-none inline-flex items-center gap-1`.
    - Badges (`ProfBadge`, `ImpBadge`): fixed height `h-4`, `text-[10px] leading-none inline-flex items-center justify-center`.
    - This guarantees that text label vertical paddings and baselines match with 100% pixel fidelity between naval ships and land-based air bases.
  - All slot action controls use the shared `<EquipSlotControls>` component. Avoid duplicating click handlers or placeholder spans.
  - **Strict Pixel Alignment & Fixed Widths**:
    - To eliminate layout jitter and misaligned columns between adjacent slots, badges must use strict fixed widths with `shrink-0`:
      - **Proficiency Badge (`ProfBadge`)**: fixed width `w-7` (28px).
      - **Dynamic Proficiency Space Release for Non-Aircraft Slots**: For non-aircraft equipment (where `canShowProf` is false, such as main guns, torpedoes, radars, armor-piercing shells, and reinforcement expansion slots), **never render an empty proficiency placeholder span (`<span class="w-7" />`)**. Releasing this 28px space immediately allocates it to the equipment name container (`flex-1 truncate`), preventing text truncation and ensuring long equipment names remain fully legible.
      - **Improvement Badge (`ImpBadge`)**: fixed width `w-7` (28px). Empty slot placeholder: `<span class="w-7 shrink-0" />`. (Standardized with `ProfBadge` at 28px).
      - **Delete Button (`DeleteIcon`)**: fixed size `w-5 h-5` (20px). Empty slot placeholder: `<span class="w-5 h-5 shrink-0" />`.
      - **Airbase Distance**: fixed width `w-6` (24px) when present.
    - Layout container uses `ml-auto flex items-center justify-end gap-1 shrink-0` to guarantee that improvement, proficiency, and delete action columns align with 100% vertical precision from slot 1 through expansion slots.
- **Pill Badges (Proficiency & Improvement)**:
  - **Zero-state Affordance & Transition Preview**:
    - **Never show "0" for Proficiency**: When level is 0, hide the badge by default. On row hover, display the next transition target state (i.e. `|` as dashed blue preview `border-dashed border-blue-400/50`). Never display `>>0` or `0`.
    - **Never use dense kanji like `+熟`** in small UI components (10-11px font sizes). Always stick to pure ASCII/symbols and numbers (e.g. `|`, `||`, `>>`, `★0`).
  - **Card Artwork Contrast (Solid Surface)**:
    - Badges must render on an opaque base plate (`bg-base-100/95` or `bg-base-100/90` with border and shadow) to prevent underlying ship artwork from bleeding through the badge text.
    - **Proficiency (`ProfBadge`)**: Blue dashed (`Lv.0` transition preview `|`), Blue (`Lv.1-3`), Amber (`Lv.4-6`), Orange bold (`Lv.7 >>`).
    - **Improvement (`ImpBadge`)**: Teal-400 (`★1-9`), Teal-300 bold with `MAX` display (no ★ symbol, scaled with `scaleX(0.78)` to precisely match `★9` width) at level 10, dashed outline with `★0` at Level 0.
  - **Tooltips**: Always equip badges with descriptive tooltips including transition prompt (e.g. `熟練度: なし (クリックで「|」に設定)`, `熟練度: Lv.1 (|) (クリックで「||」へ)`, `熟練度: Lv.7 (>>) (クリックで解除)`, `改修値: ★0 (クリックで★1へ)`).
- **Responsive Stat Table & Horizontal Scaling (`StatCell`, `ImpBadge`, `ProfBadge`)**:
  - **Fluid 2-Column Grid Layout**:
    - The stat table container strictly uses `w-full grid grid-cols-2 gap-x-1.5 gap-y-0 px-2 py-0 border-t border-base-200/50 leading-none` instead of hardcoded rem widths (`w-[6.2rem]`).
    - This allows both stat columns to proportionally scale and automatically adapt to any screen width and card width without layout breakage.
  - **StatCell Grid & Metric Allocation**:
    - `StatCell` uses `w-full min-w-0 grid grid-cols-[1.25rem_1fr_1.25rem] items-center gap-0 group/stat h-3.5`.
    - Label column: `1.25rem` (20px), text-[10px], whitespace-nowrap.
    - Value column: `1fr` flexible space, text-[10px], right-aligned with `overflow-visible`.
    - Bonus column: `1.25rem` (20px), text-[10px], font-mono font-semibold, left-aligned.
  - **Horizontal Glyph Compression (長体 / `transform: scaleX(...)`)**:
    - Rather than merely reducing font size or squeezing `letter-spacing`, text glyphs are horizontally scaled directly using CSS `transform: scaleX(...)` with explicit `transform-origin` to preserve font height and weight:
      - **Stat Values (`StatCell`)**:
        - 3+ characters ("超長+", "高速+"): `transform: scaleX(0.72); transform-origin: right center; display: inline-block;`
        - 2 non-numeric characters ("超長", "高速", "最速"): `transform: scaleX(0.85); transform-origin: right center; display: inline-block;`
        - Single characters / digits: natural `text-[10px]`.
      - **Improvement Badge (`ImpBadge`)**:
        - `MAX` (level 10): rendered without the "★" symbol as pure "MAX", horizontally scaled via `transform: scaleX(0.78); transform-origin: center center; letter-spacing: -0.04em;` so its glyph width matches `★9` with 100% pixel fidelity inside a compact `w-7` (28px) badge container.
      - **Proficiency Badge (`ProfBadge`)**:
        - Uniform badge width across all tiers: 3 characters (`|||`, `\\\`): `scaleX(0.72)`, 2 characters (`||`, `\\`, `>>`): `scaleX(0.88)`, 1 character (`|`, `\`): `scaleX(1.0)` with `transform-origin: center center`, standardizing the occupied glyph width regardless of stage.
- **Action Buttons (Edit & Delete)**:
  - **Strict Hover-Only Visibility (`cardHovered()`)**:
    - Both the Edit button (`✎`) and Delete button (`✕`) on the ship card header must remain hidden by default (`opacity-0 scale-95 pointer-events-none`) and appear smoothly **only when hovering over the ship card deck** (`opacity-100 scale-100`). Neither button should be permanently visible.
  - **No Gradient Policy (Strict Solid Colors)**:
    - **Never use gradients (e.g. `radial-gradient`, `linear-gradient`) on action/delete buttons**. Gradients cause severe washed-out white halos, color muddiness, and illegibility in light mode. Buttons must strictly use uniform, solid colors for both default and hover states (`bg-base-100/90` default, `hover:bg-error` / `hover:bg-primary` on hover).
    - Do not apply CSS blur filters (`filter: blur(...)`) to buttons as they degrade icon sharpness.
  - **Artwork Isolation (Solid Button Plate)**:
    - Action buttons that sit over ship illustration cutaways must use an opaque surface (`bg-base-100/90 backdrop-blur-xs border border-base-300/80 shadow-2xs`).
    - **Delete Icon**: Use 2.2px stroke thickness to maintain sharp legibility at 14x14px size.
  - **Strict Metric Matching Between Edit and Delete Buttons**:
    - Both buttons use identical outer bounding dimensions: `w-5 h-5` (20px × 20px).
    - Both buttons use dedicated, precision SVG vector icons with identical 14px × 14px bounding boxes (`w-3.5 h-3.5 shrink-0`). Never use raw font unicode glyphs (such as `✎` in text-xs) as font metrics and glyph ascenders cause visually divergent button sizes.
  - **Edit Button (`EditIcon`)**:
    `w-5 h-5 inline-flex items-center justify-center leading-none rounded-md bg-base-100/90 backdrop-blur-xs border border-base-300/80 text-base-content/75 hover:bg-primary hover:text-primary-content hover:border-primary shadow-2xs active:scale-90 transition-all duration-150 shrink-0 cursor-pointer`
    Contains `<EditIcon />` (`w-3.5 h-3.5`, 1.8px stroke).
    Tooltip: `艦の諸元（Lv・運・改修値）を一括編集`
  - **Delete Button (`DeleteIcon` / `✕`)**:
    `w-5 h-5 inline-flex items-center justify-center leading-none rounded-md bg-base-100/90 backdrop-blur-xs border border-base-300/80 text-base-content/75 hover:bg-error hover:text-error-content hover:border-error shadow-2xs active:scale-90 transition-all duration-150 shrink-0 cursor-pointer`
    Contains `<DeleteIcon />` (`w-3.5 h-3.5`, 2.2px stroke).
    Tooltip: `この艦を編成から外す` / `この装備を外す`


### 9. Fleet Deck Layout & Section Stacking
- **Single-Column Fleet Stacking (Never Two-Column)**:
  - Fleet sections (`#fleet-sections`: Fleet 1, Fleet 2, Fleet 3, Fleet 4) must **always stack vertically in a single column** (`grid-template-columns: minmax(0, 76rem)` / `minmax(0, 26rem)` on mobile).
  - **Never place Fleet 1 and Fleet 2 side-by-side in 2 columns** on intermediate screen widths (e.g. tablet 768px-1199px). Horizontal side-by-side fleet layouts cause extreme horizontal card squishing and fatiguing eye movements.
- **Responsive Deck Slot Grid (3x2 Desktop, 2x3 Tablet/900px, 1-col Mobile)**:
  - **Desktop (>= 1024px)**: Fixed to **3 columns × 2 rows ("3x2": `repeat(3, minmax(0, 1fr))`)** with standard `76rem` (1216px) content width.
  - **Tablet / 900px (640px - 1023px)**: Automatically uses **2 columns × 3 rows ("2x3": `repeat(2, minmax(0, 1fr))`)** with `52rem` (832px) max width, preserving comfortable card width and readability.
  - **Mobile (< 640px)**: Collapses into a **single column (`minmax(0, 1fr)`)** with `26rem` (416px) max width.
  - **Fleet Stacking Invariant**: Regardless of whether the internal slot grid is 3x2, 2x3, or 1-col, **Fleet sections (Fleet 1, Fleet 2, etc.) ALWAYS stack vertically in a single column** and never place side-by-side in 2 columns.
  - The manual "2x3 vs 3x2" select dropdown in the display modal is abolished; the responsive transition is handled purely and predictably by viewport width.

### 10. Fleet Mode Switching & Unified Data Import
- **Modal-Free Quick Fleet Mode Switching (`#fleet-mode-selector`)**:
  - Located directly in the Deck Status Bar (`#deck-status-bar`) next to the active deck name and auto-save indicators.
  - Allows instant switching between **通常艦隊 (第1艦隊)**, **連合艦隊 (機動部隊 / 水上打撃部隊 / 輸送護衛部隊)**, and **遊撃艦隊 (第3艦隊)** in 1 click without opening the Display Settings modal.
  - When "通常艦隊" is selected: `combinedFleetType = 0`, shows Fleet 1 only.
  - When "連合艦隊" is selected: `combinedFleetType = 1, 2, or 3`, shows Fleet 1 and Fleet 2, displaying "機動部隊 / 水上打撃部隊 / 輸送護衛部隊" badge on Fleet 1 and "護衛" badge on Fleet 2.
  - When "遊撃艦隊" is selected: `combinedFleetType = 0`, shows Fleet 3 directly with an active `遊撃艦隊` badge on Fleet 3's section header.
  - **7-Ship Strike Force Configuration**:
    - Fleet 3 is specifically configured to support **up to 7 ships** (`STRIKE_FLEET_SLOT_INDEXES = [0, 1, 2, 3, 4, 5, 6]`), matching the game's actual Strike Force specification.
    - All equipment assignment, ship selection, modal targeting, calculations (air power, LOS, transport points, resource consumption), and sharing/serialization seamlessly support the 7th ship slot.
  - **Status Bar Layout Invariants & No-Wrap**:
    - The `艦隊形式:` selector and label are placed in the left group beside the active deck name with strict `whitespace-nowrap shrink-0` to guarantee that the label never wraps onto multiple lines.
    - Right side contains auto-save and workspace links only, maintaining breathing room across desktop and tablet (900px) widths.
- **Unified Data Import Button & Modal (`#btn-import`, `DataImportModal`)**:
  - The previous separate header buttons "R2読込" and "APIレスポンス貼り付け" are unified into a single, cohesive **「データ読込」** button (`#btn-import`).
  - Opens `DataImportModal`, featuring clean tab navigation:
    - **Tab 1: R2クラウド読込**: Displays saved fleet snapshots from R2 with fully localized Japanese aid text for authentication/linking guidance.
    - **Tab 2: APIレスポンス貼り付け**: Allows direct pasting of `api_port`, `require_info`, and `api_start2/getData` JSON responses with automatic detection and parse error feedback.
- **Japanese Aid & Localization Policy**:
  - All modals, aids, instructions, and error banners in the fleet data workflow must be presented in clear, natural Japanese.
  - Strictly adhere to project vocabulary: Use "艦" (Ship), never "艦娘".