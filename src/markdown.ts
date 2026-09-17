/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

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
} satisfies Record<FileCategory, string>

/** GitHub's own PR-level counts, shown alongside ours so the gap is visible. */
export type GitHubDiffTotals = {
  additions: number
  deletions: number
}

const hasAnyLine = (tally: CategoryTally) =>
  CHANGE_KINDS.some(
    (kind) => tally[kind].code + tally[kind].comment + tally[kind].blank > 0
  )

const row = (label: string, tally: CategoryTally) =>
  `| ${label} | ${tally.added.code} | ${tally.modified.code} | ${tally.removed.code} | ${tally.added.comment} | ${tally.removed.comment} |`

/**
 * Renders one diff as a table. Returns markdown ready to post or display, with
 * untouched categories left out of the table entirely.
 */
export function renderMarkdown(
  tally: DiffTally,
  options: { title?: string; gitHubTotals?: GitHubDiffTotals } = {}
): string {
  const { title = 'PR code lines', gitHubTotals } = options
  const lines = [`### ${title}`, '']

  // The tally carries every category; a row is only worth showing for one the
  // diff actually touched.
  const shown = FILE_CATEGORIES.filter((category) =>
    hasAnyLine(tally.byCategory[category])
  )

  if (shown.length === 0) {
    lines.push(
      'No counted line changes — nothing but renames, moves, or files cloc does not count.'
    )
    return lines.join('\n')
  }

  const source = tally.byCategory.source
  const context = gitHubTotals
    ? ` &nbsp;·&nbsp; GitHub reports +${gitHubTotals.additions} / −${gitHubTotals.deletions}`
    : ''

  lines.push(
    `**Source code: +${source.added.code} / ~${source.modified.code} / −${source.removed.code}**${context}`,
    '',
    '| | + code | ~ code | − code | + comment | − comment |',
    '| --- | --: | --: | --: | --: | --: |',
    ...shown.map((category) =>
      row(CATEGORY_LABELS[category], tally.byCategory[category])
    )
  )
  if (shown.length > 1) lines.push(row('**Total**', tally.total))

  lines.push(
    '',
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's. Blank lines are excluded above: +${tally.total.added.blank} / −${tally.total.removed.blank}.</sub>`
  )

  return lines.join('\n')
}
