/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

import { sum } from 'es-toolkit'
import { markdownTable } from 'markdown-table'
import { z } from 'zod'

import { CHANGE_KINDS } from './cloc/run.ts'
import {
  type CategoryTally,
  type DiffTally,
  FILE_CATEGORIES,
  type FileCategory,
} from './tally.ts'

const CATEGORY_LABELS = {
  source: 'Source',
  tests: 'Tests',
  generated: 'Generated',
  docs: 'Docs',
  config: 'Config',
} as const satisfies Record<FileCategory, string>

/**
 * GitHub's own PR-level counts, shown alongside ours so the gap is visible.
 * Exported as a schema because the event payload they come from is untyped.
 */
export const githubDiffTotalsSchema = z.object({
  additions: z.number(),
  deletions: z.number(),
})

export type GithubDiffTotals = z.infer<typeof githubDiffTotalsSchema>

/** Whether a category earned a row: any count, of any kind, above zero. */
const hasAnyLine = (tally: CategoryTally) =>
  sum(CHANGE_KINDS.flatMap((kind) => Object.values(tally[kind]))) > 0

const row = (label: string, tally: CategoryTally) =>
  [
    label,
    tally.added.code,
    tally.modified.code,
    tally.removed.code,
    tally.added.comment,
    tally.removed.comment,
  ].map(String)

/**
 * Renders one diff as a table. Returns markdown ready to post or display, with
 * untouched categories left out of the table entirely.
 */
export function renderMarkdown(
  tally: DiffTally,
  {
    title = 'PR code lines',
    githubTotals: ghTotals,
  }: { title?: string; githubTotals?: GithubDiffTotals } = {}
): string {
  const lines = [`### ${title}`]

  // The tally carries every category; a row is only worth showing for one the
  // diff actually touched.
  const shown = FILE_CATEGORIES.filter((category) =>
    hasAnyLine(tally.byCategory[category])
  )

  if (shown.length === 0) {
    lines.push(
      'No counted line changes — nothing but renames, moves, or files cloc does not count.'
    )
    return lines.join('\n\n')
  }

  const rows = shown.map((category) =>
    row(CATEGORY_LABELS[category], tally.byCategory[category])
  )
  if (shown.length > 1) rows.push(row('**Total**', tally.total))

  const source = tally.byCategory.source
  const ghTotalsStr = ghTotals
    ? ` &nbsp;·&nbsp; GitHub reports +${ghTotals.additions} / −${ghTotals.deletions}`
    : ''

  lines.push(
    `**Source code: +${source.added.code} / ~${source.modified.code} / −${source.removed.code}**${ghTotalsStr}`,
    markdownTable(
      [
        [
          // headers
          '',
          ...[
            ['+', 'code'],
            ['~', 'code'],
            ['−', 'code'],
            ['+', 'comment'],
            ['−', 'comment'],
          ].map(([sign, label]) => `${sign}&nbsp;${label}`),
        ],
        // rows
        ...rows,
      ],
      // Counts read as columns of digits; only the labels want the left edge.
      { align: ['l', 'r', 'r', 'r', 'r', 'r'] }
    ),
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's.</sub>`,
    `<sub>Blank lines are excluded above: +${tally.total.added.blank} / −${tally.total.removed.blank}.</sub>`
  )

  return lines.join('\n\n')
}
