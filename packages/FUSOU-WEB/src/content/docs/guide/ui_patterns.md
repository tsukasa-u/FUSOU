---
title: UI Patterns Overview
contributors: ["tsukasa-u"]
description: Catalog of reusable UI decisions adopted by the team
date: 2025-10-10
slug: guide/ui_patterns
tags: [guide, design]
---

# UI Patterns Overview

## Buttons

- Primary: `btn btn-primary` reserved for main actions
- Secondary: ghost style via `btn btn-outline`
- Destructive: `btn btn-error` with confirmation dialogs

## Form layout

1. Use vertical stacking for mobile, two-column grid for desktop.
2. Validation errors appear inline beneath fields.
3. Required fields include an asterisk and accessible label.

## Modals

- Use `shared-ui` Modal component.
- Set `aria-labelledby` and `aria-describedby`.
- Close handlers should be debounced to prevent double submission.

## Dark mode support

```tsx
const theme = createSignal("system");
createEffect(() => {
  document.documentElement.dataset.theme = theme();
});
```

## Accessibility checklist

- Tab order verified
- Keyboard shortcuts documented
- Focus states visible with 3:1 contrast
- Screen reader labels provided

## Pattern library updates

- Document new components in Storybook
- Capture screenshots for release notes
- Add usage guidance under `/docs/guide/components`
