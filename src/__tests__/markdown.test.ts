import { mapValues } from 'es-toolkit'
import type { PartialDeep } from 'type-fest'
import { describe, expect, it } from 'vitest'

import type { ClocDiffReport } from '../cloc/run.ts'
import { renderMarkdown } from '../markdown.ts'
import { type CategoryGlobs, tallyDiff } from '../tally.ts'

/** Builds the `--by-file` shape from just the entries a case cares about. */
const clocReport = (sections: PartialDeep<ClocDiffReport>): ClocDiffReport =>
  mapValues(sections, (files) =>
    mapValues(files ?? {}, (c) => ({ code: 0, comment: 0, blank: 0, ...c }))
  )

const GLOBS = {
  tests: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*'],
  generated: ['**/package-lock.json', '**/migrations/**'],
  docs: ['**/*.md'],
  config: ['**/*.json', '**/*.yml'],
} as const satisfies CategoryGlobs

/** The cells of one table row, so a case can assert numbers without the markdown. */
const rowCells = (markdown: string, label: string) =>
  markdown
    .split('\n')
    .find((line) => line.startsWith(`| ${label} |`))
    ?.split('|')
    .slice(2, -1)
    .map((cell) => cell.trim())

const render = (report: ClocDiffReport, globs: CategoryGlobs = GLOBS) =>
  renderMarkdown(tallyDiff(report, globs))

describe('renderMarkdown', () => {
  it('headlines source code only, not the total', () => {
    const markdown = render(
      clocReport({
        added: { 'src/a.ts': { code: 10 }, 'src/a.test.ts': { code: 500 } },
      })
    )

    expect(markdown).toContain('**Source code: +10 / ~0 / −0**')
  })

  it('separates code from comment columns per category', () => {
    const markdown = render(
      clocReport({
        added: { 'src/a.ts': { code: 91, comment: 106 } },
        removed: { 'src/a.ts': { code: 9, comment: 42 } },
      })
    )

    expect(rowCells(markdown, 'Source')).toEqual(['91', '0', '9', '106', '42'])
  })

  it('leaves out a category the diff never touched', () => {
    // The tally always carries all four; only the touched ones earn a row.
    const markdown = render(clocReport({ added: { 'src/a.ts': { code: 5 } } }))

    expect(rowCells(markdown, 'Source')).toEqual(['5', '0', '0', '0', '0'])
    expect(markdown).not.toContain('Generated')
    expect(markdown).not.toContain('Tests')
  })

  it('totals across categories, and omits the total row for a single one', () => {
    const many = render(
      clocReport({
        added: { 'src/a.ts': { code: 5 }, 'src/a.test.ts': { code: 2 } },
      })
    )
    const one = render(clocReport({ added: { 'src/a.ts': { code: 5 } } }))

    expect(rowCells(many, '**Total**')?.[0]).toBe('7')
    expect(one).not.toContain('**Total**')
  })

  it("notes GitHub's own totals only when given them", () => {
    const tally = tallyDiff(
      clocReport({ added: { 'src/a.ts': { code: 5 } } }),
      GLOBS
    )

    expect(
      renderMarkdown(tally, {
        gitHubTotals: { additions: 329, deletions: 144 },
      })
    ).toContain('GitHub reports +329 / −144')
    expect(renderMarkdown(tally)).not.toContain('GitHub reports')
  })

  it('reports blank lines as a footnote rather than a column', () => {
    const markdown = render(
      clocReport({
        added: { 'src/a.ts': { code: 1, blank: 12 } },
        removed: { 'src/a.ts': { blank: 3 } },
      })
    )

    expect(markdown).toContain('Blank lines are excluded above: +12 / −3.')
    expect(rowCells(markdown, 'Source')).toEqual(['1', '0', '0', '0', '0'])
  })

  it('takes a custom title', () => {
    const tally = tallyDiff(
      clocReport({ added: { 'src/a.ts': { code: 1 } } }),
      GLOBS
    )

    expect(renderMarkdown(tally, { title: 'Diff size' })).toContain(
      '### Diff size'
    )
  })

  it('reports an empty diff as no counted changes', () => {
    const markdown = render({})

    expect(markdown).toContain('No counted line changes')
    expect(markdown).not.toContain('| + code |')
  })
})
