# PR Code Lines

GitHub tells you a pull request is `+329 −144`. That number counts every line the diff touches, so 300 lines of doc comments reads exactly like 300 lines of logic, and a regenerated lockfile reads like a rewrite.

This action recounts the same range with [cloc](https://github.com/AlDanial/cloc), which parses comments per language rather than guessing at them, and hands back the per-file result.

> **Status**: this release does the counting and exposes the raw result. Categorising files and posting the table as a PR comment land next.

## Usage

```yaml
on: pull_request

permissions:
  contents: read

jobs:
  count:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # both ends of the range have to be in the clone

      - id: lines
        uses: bvandrc/pr-code-lines@v1

      - run: echo '${{ steps.lines.outputs.json }}'
```

`fetch-depth: 0` is required. The action counts from the **merge base** of the two revisions, not from the base branch's tip, so a PR isn't billed for commits that landed on the base after it forked — and a shallow clone doesn't have that commit.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `base-sha` | the PR's base | Revision to count from. The merge base of the two is what gets counted. |
| `head-sha` | the PR's head | Revision to count to. |

Set both to run outside a `pull_request` event.

## Output

`json` — cloc's per-file diff:

```json
{
  "added":    { "src/thing.ts": { "code": 91, "comment": 106, "blank": 10 } },
  "modified": { "src/thing.ts": { "code": 68, "comment": 21,  "blank": 0  } },
  "removed":  { "src/thing.ts": { "code": 9,  "comment": 42,  "blank": 1  } },
  "same":     { "src/other.ts": { "code": 2374, "comment": 752, "blank": 23 } }
}
```

Every changed path appears in each section, zeroed where that kind didn't apply. `SUM` and `header` sit among the per-file entries and are not files.

`modified` counts a line changed in place **once**, rather than as an add plus a delete, so these numbers deliberately don't sum to GitHub's own `+/−`.

## How it counts

cloc is fetched from its upstream release as a single pinned Perl script, verified against a SHA-256 checksum before it runs, and cached between runs. It is deliberately **not** installed from the `cloc` npm package: that package's version numbers are decoupled from the tool's, and `cloc@2.06` installs cloc **1.86** — which reads a rename as a whole file added plus a whole file deleted, overstating any renaming PR by the moved file's entire length.

Perl is present on all GitHub-hosted runners. On a self-hosted runner without it, the action fails with a clear message rather than reporting zeros.

## Limitations

- **Renames** are only as good as `git`'s own rename detection; a heavily edited move may still read as an add plus a delete.
- **Markdown and plain text have no comment syntax**, so their prose counts as `code`.
- **Binary and unrecognized files** contribute nothing. A range holding nothing countable resolves to `{}`.
- **A file cloc cannot diff fails the run.** cloc's diff cost climbs roughly quadratically with the number of changed lines, and it reports a file it gave up on as wholly removed while still exiting 0. The per-file budget is 300s, far above cloc's own 10s default, and any file that still exceeds it is named in an error rather than published as a count.

## Licence

[MIT](LICENSE)
