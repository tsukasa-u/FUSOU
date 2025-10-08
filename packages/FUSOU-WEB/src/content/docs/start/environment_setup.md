---
title: Environment Setup Walkthrough
author: test-writer
description: Detailed setup guide including tooling notes
date: 2025-10-10
slug: start/environment_setup
tags: [start, environment]
---

# Environment Setup Walkthrough

1. Install **Node.js 20 LTS** via Volta.
2. Install **pnpm 9** globally.
3. Ensure `git config --global pull.rebase true`.
4. Configure VS Code extensions:
   - Astro
   - ESLint
   - Prettier
   - Tailwind CSS IntelliSense
5. Create `.env` with:
   ```bash
   API_URL=http://localhost:4000
   FEATURE_FLAGS=preview
   ```
6. Validate versions:
   ```bash
   node -v
   pnpm -v
   git --version
   ```

> Tip: Run `pnpm dlx envinfo --system --binaries` and paste the output in onboarding tickets.
