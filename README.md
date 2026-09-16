# PR Code Lines

GitHub tells you a pull request is `+329 −144`. That number counts every line the diff touches, so 300 lines of doc comments reads exactly like 300 lines of logic, and a regenerated lockfile reads like a rewrite.

This action recounts the same range with [cloc](https://github.com/AlDanial/cloc), which parses comments per language rather than guessing at them, and sorts the changed files into source, tests, generated and docs.

> **Status**: this release counts and categorises, and exposes the tallies as outputs. Rendering the table and posting it as a PR comment land next.

## Usage

```yaml
on: pull_request

permissions:
  contents: read

jobs:
  count:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # both ends of the range have to be in the clone

      - id: lines
        uses: bvandrc/pr-code-lines@v1

      - run: echo '${{ steps.lines.outputs.source-code-added }} lines of source code'
```

`fetch-depth: 0` is required. The action counts from the **merge base** of the two revisions, not from the base branch's tip, so a PR isn't billed for commits that landed on the base after it forked — and a shallow clone doesn't have that commit.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `base-sha` | the PR's base | Revision to count from. The merge base of the two is what gets counted. |
| `head-sha` | the PR's head | Revision to count to. |
| `test-patterns` | see `action.yml` | Globs counted as tests, one per line. |
| `generated-patterns` | see `action.yml` | Globs counted as generated, one per line. |
| `docs-patterns` | see `action.yml` | Globs counted as docs and config, one per line. |

Set both revisions to run outside a `pull_request` event.

### Categories

The three pattern inputs are matched **in that order — tests, then generated, then docs — and the first match wins**, so a spec file under a generated directory is still a test. Anything matching none of them counts as **source**, so an unfamiliar language or an extensionless file is counted rather than quietly dropped.

The defaults cover the usual conventions across ecosystems (`**/__tests__/**`, `**/*_test.go`, `**/package-lock.json`, `**/dist/**`, `**/*.md`, …) and live in `action.yml`. Setting an input replaces that category's list rather than adding to it.

## Outputs

| Output | Meaning |
| --- | --- |
| `source-code-added` / `-modified` / `-removed` | Code lines in **source** files only — the number GitHub's `+/−` buries. |
| `code-added` / `-modified` / `-removed` | Code lines across every category. |
| `comment-added` / `comment-removed` | Comment lines across every category. |
| `json` | Every tally, as `{byCategory,total}`. |

`json` looks like this, with untouched categories left out and each category holding one `{code,comment,blank}` per change kind:

```json
{
  "byCategory": [
    ["SOURCE", { "added": { "code": 91, "comment": 106, "blank": 10 }, "modified": { … }, "removed": { … } }],
    ["TESTS",  { "added": { "code": 12, "comment": 4,   "blank": 2  }, "modified": { … }, "removed": { … } }]
  ],
  "total": { "added": { … }, "modified": { … }, "removed": { … } }
}
```

`modified` counts a line changed in place **once**, rather than as an add plus a delete, so these numbers deliberately don't sum to GitHub's own `+/−`.

## How it counts

cloc is fetched from its upstream release as a single pinned Perl script, verified against a SHA-256 checksum before it runs, and cached between runs. It is deliberately **not** installed from the `cloc` npm package: that package's version numbers are decoupled from the tool's, and `cloc@2.06` installs cloc **1.86** — which reads a rename as a whole file added plus a whole file deleted, overstating any renaming PR by the moved file's entire length.

Perl is present on all GitHub-hosted runners. On a self-hosted runner without it, the action fails with a clear message rather than reporting zeros.

## Limitations

- **Renames** are only as good as `git`'s own rename detection; a heavily edited move may still read as an add plus a delete.
- **Markdown and plain text have no comment syntax**, so their prose counts as `code`. That's why `**/*.md` is a docs pattern by default rather than a source one.
- **Binary and unrecognized files** contribute nothing. A PR of nothing but images reports no counted line changes.
- **A file cloc cannot diff fails the run.** cloc's diff cost climbs roughly quadratically with the number of changed lines, and it reports a file it gave up on as wholly removed while still exiting 0. The per-file budget is 300s, far above cloc's own 10s default, and any file that still exceeds it is named in an error rather than published as a count.

## Licence

[MIT](LICENSE)
