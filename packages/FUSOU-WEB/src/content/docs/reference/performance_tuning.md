---
title: Performance Tuning Notes
contributors: ["tsukasa-u"]
description: Profiling, metrics, and optimization guidelines
date: 2025-10-10
slug: reference/performance_tuning
tags: [reference, performance]
---

# Performance Tuning Notes

## Metrics

- LCP under 2.5s
- CLS below 0.1
- TTI under 3s on mid-tier devices

## Profiling toolkit

1. Chrome DevTools Performance panel
2. Web Vitals extension
3. Lighthouse CI (configured under `.github/workflows/perf.yml`)

## Optimization steps

- Prefer `solid-transition-group` for heavy DOM animations.
- Defer non-critical scripts with `is:inline`.
- Use Astro image optimizations:
  ```astro
  <Image src={heroImage} format="webp" width={960} alt="Hero" />
  ```
- Cache API responses with `createResource` and sensible `staleTime`.

## Monitoring

- Report metrics to Vercel Analytics
- Capture errors via Sentry performance tracing
- Track backend latency with Grafana dashboards

## Regression prevention

- Add custom Lighthouse budgets
- Break down large pull requests
- Automate bundle size checks via `pnpm run size-limit`
