# taskboard

A desktop task widget plus a `task` CLI. People and coding agents update the same task data.

## Workflow

- Requirements and plans live in `openspec/`. Start changes with `/opsx:propose`, implement with `/opsx:apply`, finish with `/opsx:archive`.
- Do not run Superpowers' brainstorming or writing-plans for work that already has an OpenSpec change; the OpenSpec artifacts are the plan. Do use its test-driven-development, systematic-debugging and verification-before-completion.
- After changing the widget UI, run a quick review with the `review-frontend-production` skill.

## Layout

- `src/core/` — data model, validation, storage. The only code that touches the data file.
- `src/cli/` — the `task` command. Calls `core` only.
- `src/widget/` — Electron window. The main process calls `core`; the renderer talks to it through the preload bridge.
- `test/` — `node:test` tests. Tests set `TASKBOARD_HOME` to a temp directory and never touch real data.

## Commands

- `npm test` — run all tests.
- `npm run lint` — ESLint.
- `npm start` — launch the widget.

The pre-commit hook runs tests and lint; a failure blocks the commit.

## Rules

- No personal paths, emails or real task data in the repository.
- Render user text as plain text in the widget, never as HTML.
