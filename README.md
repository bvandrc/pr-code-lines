# PR Diff Line Count

GitHub tells you a pull request is `+329 −144`. That number counts every line the diff touches, so 300 lines of doc comments reads exactly like 300 lines of logic, and a regenerated lockfile reads like a rewrite.

This action recounts the same range with [cloc](https://github.com/AlDanial/cloc), which parses comments per language rather than guessing at them, and sorts the changed files into **source**, **tests**, **generated**, **docs**, and **config**.

The result comes back three ways:

- one sticky pull request comment (optional, and edited in place rather than added to on every push)
- action outputs (counts that can be gated on)
- a job summary table

The comment, and the summary table with it:

```md
### PR Diff Line Count

**Source code: +91 / ~68 / −9**  ·  GitHub reports +329 / −144

|           | + code | ~ code | − code | + comment | − comment |
| --------- | -----: | -----: | -----: | --------: | --------: |
| Source    |     91 |     68 |      9 |       106 |        42 |
| Tests     |     12 |      0 |      0 |         4 |         0 |
| Docs      |      6 |      0 |      0 |         0 |         0 |
| Config    |      8 |      0 |      0 |         0 |         0 |
| **Total** |    117 |     68 |      9 |       110 |        42 |
```

91 lines of source code, next to GitHub's +329.

## Usage

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write # the table is posted as a sticky comment

jobs:
  count:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # REQUIRED! The merge base has to be in the clone.

      - uses: bvandrc/pr-diff-line-count@v1
```

The action counts from the **merge base** of the two revisions, not from the base branch's tip, so a pull request isn't billed for commits that landed on the base after it forked.

### Without the comment

`pull-requests: write` is needed only to post the comment. Set `comment: false` and the action needs nothing beyond `contents: read`, still writing the table to the job summary and still returning the outputs:

```yaml
permissions:
  contents: read

jobs:
  count:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # REQUIRED! The merge base has to be in the clone.

      - uses: bvandrc/pr-diff-line-count@v1
        id: lines
        with:
          comment: false

      - name: Publish the count to the steps that follow
        env:
          SOURCE_ADDED: ${{ fromJSON(steps.lines.outputs.json).byCategory.source.added.code }}
        run: echo "SOURCE_ADDED=$SOURCE_ADDED" >> "$GITHUB_ENV"

      - run: echo "$SOURCE_ADDED lines of source code"

      - name: Fail if there is too much new source to review
        if: env.SOURCE_ADDED > 400
        run: |
          echo "::error::Over $SOURCE_ADDED lines of new source code -- split this pull request."
          exit 1
```

CI here runs that path on every pull request, under `contents: read` alone, so it stays working.

## Inputs

| Input          | Default               | Purpose                                                                                  |
| -------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `github-token` | `${{ github.token }}` | Token used to post the comment. Needs `pull-requests: write`.                            |
| `comment`      | `true`                | Post the table as a sticky comment. Set `false` to use only the outputs and job summary. |
| `base-sha`     | the PR's base         | Revision to count from. The merge base of the two is what gets counted.                  |
| `head-sha`     | the PR's head         | Revision to count to.                                                                    |

Set both to run outside a `pull_request` event. The comment is skipped when there's no pull request to post it to.

## Reading the table

- **`+ code` / `− code`** — lines added and removed, excluding comments and blank lines.
- **`~ code`** — lines changed in place. cloc counts a changed line once, rather than as an add plus a delete, which is why these columns don't sum to GitHub's own `+/−`.
- **`+ comment` / `− comment`** — comment lines, parsed per language. The headline deliberately leaves them out.
- Blank lines are counted but kept to a footnote.

A category with no changes is left out of the table, and the `Total` row appears only when more than one category changed.

## Categories

- **tests** — specs, fixtures, and mocks: `**/__tests__/**`, `**/*.test.*`, `**/*_test.*`, `**/spec/**`, `**/conftest.py`, …
- **generated** — machine-written and committed: lockfiles, `**/dist/**`, `**/build/**`, `**/vendor/**`, `**/*.pb.go`, `**/__snapshots__/**`, `**/*.min.js`, …
- **docs** — prose: `**/*.md`, `**/*.rst`, `**/*.adoc`, `**/docs/**`, `LICENSE*`
- **config** — machine-read settings: `**/*.json`, `**/*.yml`, `**/*.toml`, `**/*.ini`, `**/.github/**`, `**/Dockerfile*`, `**/*.tfvars`
- **source** — the code the change is actually about: everything matching none of the above.

The categories are matched **in the order above** and the **first match wins** (i.e., a `.spec` file under a generated directory is still counted as a test). **source** is last because it is the fallback, which also means an unfamiliar language or an extensionless file is counted rather than quietly dropped.

The patterns are **not configurable yet** — every repo gets the same list, which keeps the numbers comparable between them. They live in `DEFAULT_CATEGORY_GLOBS` in `src/tally.ts`. Making them overridable is [issue #5](https://github.com/bvandrc/pr-diff-line-count/issues/5).

## Outputs

Two outputs. `markdown` is the rendered table, for posting somewhere else. `json` holds every count:

```json
{
  "byCategory": {
    "source":    { "added": { "code": 91, "comment": 106, "blank": 10 }, "modified": { … }, "removed": { … } },
    "tests":     { "added": { "code": 12, "comment": 4,   "blank": 2  }, "modified": { … }, "removed": { … } },
    "generated": { … },
    "docs":      { … },
    "config":    { … }
  },
  "total": { "added": { … }, "modified": { … }, "removed": { … } }
}
```

That's the whole format: five categories plus a `total`, each with `added`, `modified`, and `removed`, each of those with `code`, `comment`, and `blank`. Every category is always present, zeroed where the diff touched nothing of that kind, so nothing has to tell `0` apart from a missing key.

Enough to gate on, with no `jq` step:

```yaml
      - id: lines
        uses: bvandrc/pr-diff-line-count@v1

      - if: fromJSON(steps.lines.outputs.json).byCategory.source.added.code > 400
        run: echo "::warning::Large PR — consider splitting it."
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
