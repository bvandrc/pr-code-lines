import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import type { ClocDiffReport } from '../cloc/run.ts'
import { type CategoryGlobs, tallyDiff } from '../tally.ts'

type Counts = { code?: number; comment?: number; blank?: number }

const counts = ({ code = 0, comment = 0, blank = 0 }: Counts) => ({
  code,
  comment,
  blank,
})

/** Builds the `--by-file` shape from just the entries a case cares about. */
const clocReport = (sections: {
  added?: Record<string, Counts>
  modified?: Record<string, Counts>
  removed?: Record<string, Counts>
}): ClocDiffReport =>
  Object.fromEntries(
    Object.entries(sections).map(([kind, files]) => [
      kind,
      Object.fromEntries(
        Object.entries(files).map(([file, c]) => [file, counts(c)])
      ),
    ])
  )

const GLOBS: CategoryGlobs = {
  tests: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*'],
  generated: ['**/package-lock.json', '**/migrations/**'],
  docs: ['**/*.md', '**/*.json'],
}

describe('tallyDiff', () => {
  it('keeps comment and blank lines out of the code counts', () => {
    const tally = tallyDiff(
      clocReport({
        added: { 'src/thing.ts': { code: 10, comment: 40, blank: 3 } },
      }),
      GLOBS
    )

    expect(tally.total.added).toEqual({ code: 10, comment: 40, blank: 3 })
  })

  it('routes each path to its category, and anything unmatched to source', () => {
    const tally = tallyDiff(
      clocReport({
        added: {
          'src/thing.ts': { code: 5 },
          'src/__tests__/thing.ts': { code: 30 },
          'e2e/login.spec.ts': { code: 20 },
          'package-lock.json': { code: 900 },
          'db/migrations/0007_add_schedule.sql': { code: 12 },
          'README.md': { code: 4 },
          Makefile: { code: 3 },
        },
      }),
      GLOBS
    )

    const byCategory = Object.fromEntries(
      tally.byCategory.map(([category, t]) => [category, t.added.code])
    )
    // `Makefile` matches no glob, so it lands in source alongside thing.ts.
    expect(byCategory).toEqual({
      SOURCE: 8,
      TESTS: 50,
      GENERATED: 912,
      DOCS: 4,
    })
  })

  it('lets the first matching category win', () => {
    const tally = tallyDiff(
      clocReport({
        added: { 'db/migrations/__tests__/seed.test.ts': { code: 9 } },
      }),
      GLOBS
    )

    expect(tally.byCategory).toEqual([['TESTS', expect.objectContaining({})]])
  })

  it('matches dotfile directories, which a default glob would skip', () => {
    const tally = tallyDiff(
      clocReport({ added: { '.github/workflows/ci.yml': { code: 20 } } }),
      {
        ...GLOBS,
        docs: ['**/.github/**'],
      }
    )

    expect(tally.byCategory.map(([category]) => category)).toEqual(['DOCS'])
  })

  it("ignores cloc's SUM and header siblings of the per-file entries", () => {
    const tally = tallyDiff(
      clocReport({
        added: {
          'src/a.ts': { code: 5 },
          SUM: { code: 5 },
          header: { code: 99 },
        },
      }),
      GLOBS
    )

    expect(tally.total.added.code).toBe(5)
  })

  it('drops categories whose every count is zero', () => {
    const tally = tallyDiff(
      clocReport({ added: { 'logo.png': {}, 'src/a.ts': { code: 2 } } }),
      GLOBS
    )

    expect(tally.byCategory.map(([category]) => category)).toEqual(['SOURCE'])
  })

  it('sums each change kind separately', () => {
    const tally = tallyDiff(
      clocReport({
        added: { 'src/a.ts': { code: 5 } },
        modified: { 'src/a.ts': { code: 3 } },
        removed: { 'src/a.ts': { code: 4 } },
      }),
      GLOBS
    )

    expect([
      tally.total.added.code,
      tally.total.modified.code,
      tally.total.removed.code,
    ]).toEqual([5, 3, 4])
  })
})

describe("action.yml's default patterns", () => {
  // Read from action.yml rather than copied here: the defaults users actually
  // get are the ones worth pinning, and a copy would drift from them silently.
  const action = parseYaml(
    readFileSync(join(import.meta.dirname, '../../action.yml'), 'utf8')
  )
  const defaults = (name: string): string[] =>
    action.inputs[name].default
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)

  const DEFAULT_GLOBS: CategoryGlobs = {
    tests: defaults('test-patterns'),
    generated: defaults('generated-patterns'),
    docs: defaults('docs-patterns'),
  }

  const categoryOf = (file: string) => {
    const tally = tallyDiff(
      clocReport({ added: { [file]: { code: 1 } } }),
      DEFAULT_GLOBS
    )
    return tally.byCategory[0]?.[0]
  }

  it.each([
    ['client/src/lib/storage.ts', 'SOURCE'],
    ['server/index.ts', 'SOURCE'],
    ['Makefile', 'SOURCE'],
    ['src/main/kotlin/App.kt', 'SOURCE'],
    ['client/src/lib/__tests__/storage.test.ts', 'TESTS'],
    ['playwright/e2e/tasks.spec.ts', 'TESTS'],
    ['pkg/thing_test.go', 'TESTS'],
    ['src/test/java/AppTest.java', 'TESTS'],
    ['tests/conftest.py', 'TESTS'],
    ['package-lock.json', 'GENERATED'],
    ['go.sum', 'GENERATED'],
    ['migrations/0007_add_task_schedule.sql', 'GENERATED'],
    ['api/service.pb.go', 'GENERATED'],
    ['public/app.min.js', 'GENERATED'],
    ['README.md', 'DOCS'],
    ['docs/architecture.adoc', 'DOCS'],
    ['tsconfig.json', 'DOCS'],
    ['.github/workflows/ci.yml', 'DOCS'],
  ])('classifies %s as %s', (file, expected) => {
    expect(categoryOf(file)).toBe(expected)
  })
})
