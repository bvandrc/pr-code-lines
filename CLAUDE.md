# PR Code Lines — Claude Code Reference

A GitHub Action that counts the code lines a pull request changes, separating comments and blank lines from code, and tests, generated files and docs from source.

## Code conventions

Conventions live outside this file, synced from https://github.com/bvandrc/bvandrc-conventions — follow all of them:

@conventions/typescript.md — language-level TypeScript/JavaScript rules
@conventions/all.md — practice for every repo: branches, formatting, markdown, PR reviews

`conventions/` is overwritten on every sync. Edit a rule upstream, never in that directory. `biome.jsonc` extends `conventions/biome.base.json`, so lint and format rules are synced too.

## Commands

| Command             | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `npm run build`     | Bundle `src/` to `dist/index.cjs` with esbuild       |
| `npm run test:unit` | Vitest unit tests                                     |
| `npm run lint`      | Biome lint                                            |
| `npm run format`    | Biome format — **run before every commit**           |
| `npm run ts:check`  | TypeScript check                                      |
| `npm run check`     | ts + lint + tests                                     |

## Gotchas

- **`dist/` is committed on purpose**: a JS action runs the bundle, not the source. CI fails if `dist/` lags behind `src/`, so run `npm run build` and commit the result in the same change. It is marked `linguist-generated` so it collapses in diffs.
- **The bundle must stay CommonJS at a `.cjs` path**: `package.json` sets `"type": "module"`, so a CJS bundle at `dist/index.js` would be loaded as ESM and throw `require is not defined`.
- **`cloc`'s npm package is not versioned like `cloc`**: the registry's `cloc` package numbers its releases independently of the tool it bundles — `cloc@2.06` ships cloc **1.86**, which reads a rename as a whole file added plus a whole file deleted. `src/cloc.ts` pins upstream's release script by URL and sha256 instead; keep it that way.
- **Default patterns live only in `action.yml`**: `src/__tests__/report.test.ts` parses that file and asserts real paths classify correctly. Don't copy the defaults into code or tests — the copy would drift.
- **Verify against a real runner, not just unit tests**: build the bundle and run `dist/index.cjs` against a real repository with `INPUT_*`, `RUNNER_TOOL_CACHE`, `RUNNER_TEMP`, `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` set. Every bug found so far was invisible to unit tests.
