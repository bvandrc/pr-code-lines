/**
 * @fileoverview Sums `cloc --diff --by-file --json` output into one tally per
 * category. GitHub's own +/- counts every line a diff touches, so 300 lines of
 * doc comments reads the same as 300 lines of logic; this splits code from
 * comments and blank lines, and source from tests, generated files, docs, and
 * config.
 */

import { zipObject } from 'es-toolkit'
import picomatch from 'picomatch'

import {
  CHANGE_KINDS,
  type ChangeKind,
  type ClocCounts,
  type ClocDiffReport,
} from './cloc/run.ts'

const NON_SOURCE_CATEGORIES = ['tests', 'generated', 'docs', 'config'] as const

export const FILE_CATEGORIES = ['source', ...NON_SOURCE_CATEGORIES] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

/** Globs deciding what is what. Anything matching none of them counts as source. */
export type CategoryGlobs = Record<
  (typeof NON_SOURCE_CATEGORIES)[number],
  string[]
>

export type CategoryTally = Record<ChangeKind, ClocCounts>

export type DiffTally = {
  /** Every category, zeroed where the diff touched nothing of that kind. */
  byCategory: Record<FileCategory, CategoryTally>
  total: CategoryTally
}

// cloc mixes these sibling keys in among the per-file entries.
const NON_FILE_KEYS = new Set(['SUM', 'header'])

const emptyTally = (): CategoryTally => ({
  added: { code: 0, comment: 0, blank: 0 },
  modified: { code: 0, comment: 0, blank: 0 },
  removed: { code: 0, comment: 0, blank: 0 },
})

const addInto = (target: ClocCounts, source: ClocCounts) => {
  target.code += source.code
  target.comment += source.comment
  target.blank += source.blank
}

/**
 * Sums a cloc diff into one tally per category. Every category is present
 * whether or not the diff touched it, so a caller reading one never has to
 * tell "no lines" apart from "key absent".
 */
export function tallyDiff(
  report: ClocDiffReport,
  globs: CategoryGlobs
): DiffTally {
  // First match wins, so a spec file under a generated directory is still a test.
  const matchers = NON_SOURCE_CATEGORIES.map(
    (category) =>
      [
        category,
        picomatch(globs[category], {
          // because plenty of real paths are under `.github/` or `.config/` and a
          // glob that silently skips them would undercount without saying so.
          dot: true,
        }),
      ] as const
  )
  const byCategory = zipObject(
    [...FILE_CATEGORIES],
    FILE_CATEGORIES.map(() => emptyTally())
  )
  const total = emptyTally()

  for (const kind of CHANGE_KINDS) {
    for (const [path, counts] of Object.entries(report[kind] ?? {})) {
      if (NON_FILE_KEYS.has(path)) continue

      const category =
        matchers.find(([, matches]) => matches(path))?.[0] ?? 'source'
      addInto(byCategory[category][kind], counts)
      addInto(total[kind], counts)
    }
  }

  return { byCategory, total }
}
