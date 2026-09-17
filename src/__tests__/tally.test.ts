import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapValues } from 'es-toolkit'
import type { PartialDeep } from 'type-fest'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import type { ClocDiffReport } from '../cloc/run.ts'
import {
  type CategoryGlobs,
  type DiffTally,
  FILE_CATEGORIES,
  tallyDiff,
} from '../tally.ts'

/** Builds the `--by-file` shape from just the entries a case cares about. */
const clocReport = (sections: PartialDeep<ClocDiffReport>): ClocDiffReport =>
  mapValues(sections, (files) =>
    mapValues(files ?? {}, (c) => ({ code: 0, comment: 0, blank: 0, ...c }))
  )

/** Each category's added code, which is what most of these cases turn on. */
const codePerCategory = (tally: DiffTally) =>
  mapValues(tally.byCategory, (t) => t.added.code)

const GLOBS: CategoryGlobs = {
  tests: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*'],
  generated: ['**/package-lock.json', '**/migrations/**'],
  docs: ['**/*.md'],
  config: ['**/*.json', '**/*.yml'],
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

    // `Makefile` matches no glob, so it lands in source alongside thing.ts.
    expect(codePerCategory(tally)).toEqual({
      source: 8,
      tests: 50,
      generated: 912,
      docs: 4,
      config: 0,
    })
  })

  it('lets the first matching category win', () => {
    const tally = tallyDiff(
      clocReport({
        added: { 'db/migrations/__tests__/seed.test.ts': { code: 9 } },
      }),
      GLOBS
    )

    expect(codePerCategory(tally)).toEqual({
      source: 0,
      tests: 9,
      generated: 0,
      docs: 0,
      config: 0,
    })
  })

  it('matches dotfile directories, which a default glob would skip', () => {
    const tally = tallyDiff(
      clocReport({ added: { '.github/workflows/ci.yml': { code: 20 } } }),
      {
        ...GLOBS,
        config: ['**/.github/**'],
      }
    )

    expect(tally.byCategory.config.added.code).toBe(20)
    expect(tally.byCategory.source.added.code).toBe(0)
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

  it('reports every category, zeroed where the diff touched nothing', () => {
    const tally = tallyDiff(
      clocReport({ added: { 'src/a.ts': { code: 2 } } }),
      GLOBS
    )

    // A caller reading one category never has to tell 0 from a missing key.
    expect(codePerCategory(tally)).toEqual({
      source: 2,
      tests: 0,
      generated: 0,
      docs: 0,
      config: 0,
    })
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
    config: defaults('config-patterns'),
  }

  const categoryOf = (file: string) => {
    const tally = tallyDiff(
      clocReport({ added: { [file]: { code: 1 } } }),
      DEFAULT_GLOBS
    )
    return FILE_CATEGORIES.find(
      (category) => tally.byCategory[category].added.code > 0
    )
  }

  it.each([
    ['client/src/lib/storage.ts', 'source'],
    ['server/index.ts', 'source'],
    ['Makefile', 'source'],
    ['src/main/kotlin/App.kt', 'source'],
    ['client/src/lib/__tests__/storage.test.ts', 'tests'],
    ['playwright/e2e/tasks.spec.ts', 'tests'],
    ['pkg/thing_test.go', 'tests'],
    ['src/test/java/AppTest.java', 'tests'],
    ['tests/conftest.py', 'tests'],
    ['package-lock.json', 'generated'],
    ['go.sum', 'generated'],
    ['migrations/0007_add_task_schedule.sql', 'generated'],
    ['api/service.pb.go', 'generated'],
    ['public/app.min.js', 'generated'],
    ['README.md', 'docs'],
    ['docs/architecture.adoc', 'docs'],
    ['LICENSE', 'docs'],
    ['tsconfig.json', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['Dockerfile', 'config'],
    ['infra/prod.tfvars', 'config'],
  ])('classifies %s as %s', (file, expected) => {
    expect(categoryOf(file)).toBe(expected)
  })
})
