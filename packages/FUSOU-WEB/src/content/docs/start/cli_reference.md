---
title: CLI Reference Cheat Sheet
contributors: ["tsukasa-u"]
description: Frequently used pnpm commands with scenarios
date: 2025-10-10
slug: start/cli_reference
tags: [start, cli]
---

# CLI Reference Cheat Sheet

| Use case              | Command                             | Notes                   |
| --------------------- | ----------------------------------- | ----------------------- |
| Install all deps      | `pnpm install`                      | Syncs lockfile          |
| Add runtime dep       | `pnpm add axios --filter FUSOU-APP` | Scoped install          |
| Run unit tests        | `pnpm test --workspace-root`        | Root execution          |
| Clean caches          | `pnpm store prune`                  | Fixes corrupted stores  |
| Update patch versions | `pnpm up --latest --recursive`      | Confirm CI before merge |

## Scripts per workspace

- `FUSOU-APP`: `dev`, `build`, `preview`, `analyze`
- `FUSOU-WEB`: `dev`, `build`, `astro check`
- `shared-ui`: `build`, `storybook`, `lint`

Remember to run `pnpm lint && pnpm typecheck` before opening a PR.
