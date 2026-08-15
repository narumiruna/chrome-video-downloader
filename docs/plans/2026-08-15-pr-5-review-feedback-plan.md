# PR #5 Review Feedback Plan

## Goal

Resolve and verify every feedback item on PR #5 without changing the existing unrelated working-tree files.

## Context

PR #5 is the open pull request whose head branch exactly matches the current branch, `narumi/feat/playback-auto-assemble`.

The pull request has one submitted review, two unresolved inline threads, no conversation comments, and no reported GitHub status checks.

The pre-existing `skills-lock.json`, `.agents/skills/writing-plans/`, `downloads/`, and `scripts/download-izaax.mjs` changes are unrelated and must remain unmodified and unstaged.

## Review Ledger

| Feedback | Outcome | Evidence |
|---|---|---|
| `discussion_r3789091542`: Wait for assembly readiness before showing ready status. | Already addressed by the current code. | `src/popup/App.tsx` gates ready copy on `playback.assemblyReady`, and `tests/popup/App.test.tsx` proves an ended-but-not-ready update does not show ready copy before the ready event. |
| `discussion_r3789091546`: Release video registrations when elements are removed. | Already addressed by the current code. | `src/content/playback-monitor.ts` cleans and deletes detached registrations from removed subtrees, and `tests/content/playback-monitor.test.ts` proves a detached nested video no longer emits. |

## Plan

- [x] Gate ready copy in `src/popup/App.tsx` on assembly readiness and add a grace-period regression assertion in `tests/popup/App.test.tsx`; evidence: focused Vitest run passed.
- [x] Release detached video registrations in `src/content/playback-monitor.ts` and add nested-removal regression coverage in `tests/content/playback-monitor.test.ts`; evidence: focused Vitest run passed.
- [x] Inspect the full resulting diff for the same readiness and detached-registration patterns; evidence: targeted `rg` inspection found no remaining ready-copy gate on `ended` and found removal cleanup at the sole monitor registration site.
- [x] Run `npm run ci`; evidence: Biome passed with one pre-existing untracked-file info, 155 Vitest tests passed, typecheck passed, merger integration passed, dependency audit found zero vulnerabilities, build passed, 10 Playwright tests passed, and artifact audit passed.
- [ ] Re-read PR feedback, update the ledger, reply to and resolve verified threads, and archive this completed plan.
- [ ] Stage only intended paths, create signed Conventional Commits, push the branch, and refresh PR #5 once.

## Completion Checklist

- [x] Both substantive review items have evidence-backed final outcomes.
- [x] Focused regressions and all repository checks pass.
- [x] Unrelated working-tree changes remain unstaged and unmodified.
- [ ] The signed fix commit is pushed to PR #5.
- [ ] Both addressed review threads are replied to and resolved.
