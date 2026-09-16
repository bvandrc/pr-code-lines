# PR Code Lines — Claude Code Reference

A GitHub Action that counts the code lines a pull request changes, separating comments and blank lines from code, and tests, generated files and docs from source.

## Code conventions

Conventions live outside this file, synced from https://github.com/bvandrc/bvandrc-conventions — follow all of them:

@conventions/typescript.md — language-level TypeScript/JavaScript rules
@conventions/all.md — practice for every repo: branches, formatting, markdown, PR reviews

`conventions/` is overwritten on every sync. Edit a rule upstream, never in that directory.

`biome.jsonc` extends `conventions/biome.base.json`, so the lint and format rules are synced too rather than restated here. The only local addition is excluding the build output from checks.

## Gotchas

- **`dist/` is committed on purpose**: a JS action runs its bundle, not its source, so the build cannot be gitignored. `.gitattributes` marks it `linguist-generated` to keep it out of language stats and collapsed in diffs.
