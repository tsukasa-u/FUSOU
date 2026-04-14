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

## 01 / COLOR PALETTE

### Brand

- FUSOU Accent Green: #3ecf8e (primary accent for main actions)
- Data Info Blue: #4ea8ff (data/help emphasis and non-critical info)
- Alert Amber: #f7b955 (warning and attention)
- Critical Red: #f25f5c (error and destructive action)
- Accent Border: rgba(62, 207, 142, 0.28) (high-priority bordered highlight)

### Neutral Scale

- Near Black: #0f0f0f (primary button background, deepest surface)
- Dark: #171717 (page background, primary canvas)
- Dark Border: #242424 (section dividers)
- Border Dark: #2e2e2e (card and tab borders)
- Mid Border: #363636 (button borders, interactive dividers)
- Border Light: #393939 (secondary borders)
- Charcoal: #434343 (tertiary borders, dark accents)
- Dark Gray: #4d4d4d (heavy secondary text)
- Mid Gray: #8e8e8e (muted text, metadata)
- Light Gray: #b4b4b4 (secondary link text)
- Near White: #efefef (light border, subtle surface)
- Off White: #fafafa (primary text)

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

- Border: 1px solid #2e2e2e
- Radius: 12px
- Background: #171717
- Shadow: none

### Prominent Card

- Border: #363636 for stronger separation
- Radius: 12px
- Shadow: none

### Accent Card

- Border: rgba(62, 207, 142, 0.28)
- Radius: 12px
- Use only for high-priority highlights

Rules:

- Default to Standard Card for data panels.
- Use Prominent Card only for workflow grouping.
- Use Accent Card sparingly (status highlights, callouts, onboarding hints).

## 05 / FORM ELEMENTS

- Inputs use dark surfaces with clear border contrast.
- Focus state must be visible with border/accent shift.
- Error state must include both color and explanatory text.
- Labels and helper text should remain readable on dark backgrounds.
- Selects, tabs, and filters should share consistent control height within the same toolbar.
- Any async form action must show loading and post-action result feedback.

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

- Level 0 (flat): border #2e2e2e
- Level 1 (subtle): border #363636 or #393939
- Level 2 (focus only): minimal focus shadow rgba(0, 0, 0, 0.12) 0px 4px 12px
- Level 3 (accent): green accent border rgba(62, 207, 142, 0.28)

Rules:

- Prefer border contrast over shadow stacking.
- Keep hover elevation subtle; avoid motion-heavy depth illusions.

## Additional Links

- [Design System Guide](https://getdesign.md/)
