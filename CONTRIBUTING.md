# Contributing

Thanks for considering a contribution to `task-queue`. Keep changes small, tested, and aligned with the existing public API.

## Local checks

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Contribution rules

- Add or update tests for behavior changes.
- Keep README examples in sync with the implementation.
- Keep runtime dependencies minimal and intentional.
- Prefer explicit errors over surprising coercions.
