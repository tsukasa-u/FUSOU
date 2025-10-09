---
title: Testing Strategy Blueprint
contributors: ["tsukasa-u"]
description: Balanced approach across unit, integration, and E2E
date: 2025-10-10
slug: guide/testing_strategy
tags: [guide, testing]
---

# Testing Strategy Blueprint

## Pyramid

- Unit tests (60%): Vitest
- Integration tests (25%): Playwright component mode
- E2E tests (15%): Playwright full browser

## Commands

```bash
pnpm test -- --runInBand
pnpm --filter FUSOU-APP test:watch
pnpm --filter FUSOU-WEB test:e2e
```

## Coverage goals

- Statements ≥ 80%
- Branches ≥ 75%
- Lines ≥ 80%
- Functions ≥ 80%

## Review checklist

- Test files colocated with source
- Mocks reside in `__mocks__`
- Snapshot tests include intentional assertions
- Data-testids use kebab-case

## Failure triage

1. Reproduce locally with same command.
2. Check CI logs for environment differences.
3. Update flaky tests with retry logic or better synchronization.
