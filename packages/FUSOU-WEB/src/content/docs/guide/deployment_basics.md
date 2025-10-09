---
title: Deployment Basics
contributors: ["tsukasa-u"]
description: Overview of staging and production promotions
date: 2025-10-10
slug: guide/deployment_basics
tags: [guide, deployment]
---

# Deployment Basics

## Branch strategy

- `main`: production-ready
- `develop`: integration branch (auto deploy to staging)
- Feature branches: prefixed with `feat/`, `fix/`, `chore/`

## Promotion steps

1. Merge approved PR into `develop`.
2. Staging workflow runs:
   - Install dependencies
   - Execute `pnpm lint && pnpm test`
   - Run `pnpm --filter FUSOU-APP build`
   - Publish Docker image with `staging` tag
3. Smoke test staging URL.
4. Create release PR targeting `main`.
5. Production workflow triggers identical steps with `production` tag.
6. Announce deployment in #release-notes channel.

> Automation is defined in `.github/workflows/deploy.yml`. Update variables there if secrets change.
