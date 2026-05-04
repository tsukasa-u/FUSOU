# Copilot Instructions for FUSOU-WEB

These instructions apply to all work in this package.
Keep them concise, actionable, and verifiable.

## Scope and Priorities

- Scope: FUSOU-WEB package only.
- Prioritize correctness, minimal blast radius, and root-cause fixes.
- Prefer small, reversible patches over broad refactors.

## Required Workflow

1. Explore first: read related files and match existing patterns.
1. Plan briefly: identify touched files and validation steps.
1. Implement: preserve behavior unless change request requires behavior change.
1. Verify: run smallest meaningful checks and report what was/was not verified.

## Project Conventions

- Follow Astro + SolidJS/React island patterns already used in the codebase.
- Match existing Tailwind + DaisyUI UI language.
- Keep labels action-oriented and explicit.
- For onboarding/tutorial UX, prefer page-specific guidance over generic text.

## Environment and Security

- Do not introduce direct process.env reads in app code.
- In server paths, use createEnvContext + getEnv.
- Never expose secrets/tokens in client-rendered HTML.
- Keep auth callback and cookie handling explicit and server-side.

## Data and Domain

- Prefer deterministic seed/script flows over hidden fallbacks.
- Avoid area-specific one-off logic unless explicitly required.
- Keep battle/simulator source-to-view mappings explicit.

## Verification Commands

Run only what is necessary for confidence:

- pnpm run astro check
- pnpm run e2e:simulator:smoke
- pnpm run e2e:simulator
- pnpm run verify:battle-data

Use full build only when needed:

- pnpm run build

## Completion Checklist

When finishing, always report:

- Changed files and behavior impact.
- Commands/tests executed and results.
- Remaining risks or unverified areas.

## Design/Spec Requests

For non-trivial changes, include:

- Goals and non-goals.
- Alternatives and trade-offs.
- Security/privacy/observability impact.
- Rollout and rollback strategy.

See also:

- AGENTS.MD
- DESIGN.MD
