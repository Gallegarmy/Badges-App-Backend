# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. The main Fastify bootstrap is `src/server.ts`, app wiring is `src/app.ts`, HTTP/auth concerns are split into `src/http.ts` and `src/auth.ts`, and route handlers live in `src/routes.ts`. Database config is in `src/db.ts` and environment parsing is in `src/config.ts`. Shared request/user typings live under `src/types/`.

Tests live in `test/` and use Node’s built-in test runner. Database bootstrap SQL lives in `schemas/`. Build output is generated in `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

- `npm install`: install dependencies and refresh `package-lock.json`.
- `npm run dev`: run the TypeScript server locally with Node watch mode and `.env`.
- `npm run lint`: run `oxlint` against `src/` and `test/`.
- `npm run lint:fix`: apply safe automatic lint fixes.
- `npm test`: run the Node test suite.
- `npm run build`: compile TypeScript to `dist/`.
- `npm run check`: full gate; lint, typecheck, test, build.
- `docker compose up --build`: start the API and Postgres locally.

## Coding Style & Naming Conventions

Use TypeScript with ESM imports and `.ts` import extensions. Prefer small modules with one clear responsibility. Use 2-space indentation, semicolons, and descriptive camelCase names for variables/functions. Keep route paths and SQL readable; extract shared logic instead of repeating it. Linting is handled by `oxlint`; type safety by `tsc`.

## Testing Guidelines

Write tests in `test/*.test.ts`. Follow the existing `node:test` style with explicit assertions from `node:assert/strict`. Add or update tests for authentication, route behavior, or regressions when changing request handling, token logic, or database workflows. Run `npm test` for focused checks and `npm run check` before handoff.

## Commit & Pull Request Guidelines

Prefer short conventional-style commits such as `fix: prevent duplicate badge claim` or `build: add oxlint`. Keep PRs scoped and explain behavioral changes, config updates, and any schema impact. Include reproduction or verification steps, for example `npm run check` or `docker compose up --build`. If an API response changes, call that out clearly in the PR description.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local work. The example values are placeholders for development only. Never commit real or production secrets; override `POSTGRES_PASSWORD`, `DATABASE_URL`, and `JWT_SECRET` outside version control when needed.
