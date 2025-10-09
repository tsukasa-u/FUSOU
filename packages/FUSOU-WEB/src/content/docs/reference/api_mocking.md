---
title: API Mocking Playbook
contributors: ["tsukasa-u"]
description: How to emulate backend responses during development
date: 2025-10-10
slug: reference/api_mocking
tags: [reference, api]
---

# API Mocking Playbook

## Tools

- MSW (Mock Service Worker)
- MirageJS (legacy support)
- Static JSON fixtures

## Quick start

```tsx
import { setupWorker } from "msw";
import { handlers } from "./mocks/handlers";

const worker = setupWorker(...handlers);
worker.start({ onUnhandledRequest: "warn" });
```

## Handler conventions

- Exported from `packages/FUSOU-APP/src/mocks/handlers.ts`
- Group by domain: auth, resources, analytics
- Use realistic latency via `ctx.delay(300)`

## When to switch off mocks

- Integration testing against staging
- Load testing scenarios
- Debugging WebSocket flows
