# task-queue quality bar

This repository is part of a public portfolio, so the bar is practical correctness, clear documentation, and reproducible checks.

## Required checks

- `npm run typecheck` must pass.
- `npm test` must pass.
- `npm run build` must pass.
- `tsconfig.json` must keep strict TypeScript checks enabled.

## Release checklist

- Run the required checks locally.
- Confirm GitHub Actions is green on the default branch.
- Confirm Dependabot and secret scanning have no open alerts.
- Confirm the README still describes the actual API and scope.
