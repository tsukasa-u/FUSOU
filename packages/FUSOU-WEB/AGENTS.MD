# AGENTS.MD

This file defines how coding agents should work in this repository.
Scope: FUSOU-WEB package only.

## 1. Mission

- Deliver correct, testable changes with minimal blast radius.
- Prefer root-cause fixes over temporary suppression.
- Keep edits small, explicit, and reversible.

## 2. Repository Profile

- Framework: Astro (Cloudflare adapter) with SolidJS and React islands.
- Runtime: Cloudflare Workers + browser clients.
- Data sources: Supabase, R2-backed APIs, generated schema data.
- Typical work areas:
  - UI pages: src/pages/\*\*
  - Components: src/components/\*\*
  - Server routes/utilities: src/server/**, src/utility/**

## 3. Required Workflow (Explore -> Plan -> Implement -> Verify)

1. Explore

- Read related files first.
- Identify existing patterns before editing.
- If uncertain, search for similar implementations in the repo.

1. Plan

- Define affected files and validation strategy before coding.
- Prefer one coherent patch per file.

1. Implement

- Follow existing conventions (naming, structure, UI tone).
- Avoid broad refactors unless requested.
- Preserve public behavior unless change request requires it.

1. Verify

- Run the smallest meaningful checks for the change.
- Report what was verified and what was not.

## 4. Verification Commands

Use the minimum set needed for confidence:

- Type and Astro checks:
  - pnpm run astro check

- Simulator e2e:
  - pnpm run e2e:simulator:smoke
  - pnpm run e2e:simulator

- Data sanity (when changing battle/simulator parsing):
  - pnpm run verify:battle-data

If a full build is required:

- pnpm run build

## 5. Environment and Secrets Rules

- Do not introduce direct process.env reads in app code.
- Use project env helpers (createEnvContext + getEnv) in server paths.
- Never leak tokens/secrets to client-rendered HTML.
- Keep auth callback and cookie handling server-side and explicit.

## 6. UI/UX Change Rules

- Match existing design system (Tailwind + DaisyUI style).
- Keep interaction labels clear and action-aligned.
- For onboarding/tutorial UI, prefer page-specific guidance over generic text.
- If changing UI behavior, provide a reproducible verification path.

## 7. Data and Domain Rules

- Prefer deterministic seed/script flows over hidden fallbacks.
- Avoid area-specific one-off logic unless explicitly required.
- For battle/simulator transforms, keep source-to-view mappings explicit.

## 8. Editing Discipline

- Touch only files needed for the request.
- Do not revert unrelated user changes.
- Do not run destructive git commands.
- Keep comments concise and only where logic is non-obvious.

## 9. PR/Change Summary Expectations

When finishing a task, include:

- What changed (files and behavior).
- How it was verified (commands/tests/screenshots if relevant).
- Remaining risks or unverified areas.

## 10. Design Input Quality Bar

When asked to create docs/specs:

- State goals and non-goals.
- Document alternatives and trade-offs.
- Include security/privacy/observability impact.
- Include rollout and rollback strategy.

## References Used

- Claude Code best practices (concise always-on instructions, verify work, explore then implement).
- Google-style design doc anatomy (context, goals/non-goals, alternatives, cross-cutting concerns).
- VS Code customization guidance for workspace-level agent conventions.
