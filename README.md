# Storybook Workshop

> Personalized AI-generated children's picture-book product. Build-a-Bear-style workshop. On-device privacy. Lulu Direct print + ship.

Standalone repository extracted from `grantalope/pachinko-app` (June 2026) per ADR-0042. See `CLAUDE.md` for architecture overview, `docs/adr/` for decisions, `docs/specs/` for design.

## Quickstart

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173.

## Tests

```bash
pnpm test        # vitest
pnpm test:e2e    # playwright
```


## Security

Security policy and vulnerability reporting: see [SECURITY.md](./SECURITY.md).

Production deploy contract (required env vars + boot-time gate): see
[docs/production-deploy.md](./docs/production-deploy.md).

## License

MIT. See `LICENSE`.
