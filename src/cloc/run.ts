/**
 * @fileoverview Runs cloc over a revision range, and the shape it hands back --
 * cloc being the thing that actually knows a comment from a line of code.
 */

import { readFile } from 'node:fs/promises'
import { info } from '@actions/core'
import { exec } from '@actions/exec'
import { z } from 'zod'

import { downloadCloc } from './download.ts'

export const CHANGE_KINDS = ['added', 'modified', 'removed'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/**
 * `loose()` on both levels: cloc adds fields between releases -- `nFiles` sits
 * beside the counts already -- and an addition is no reason to fail. A count
 * that stops being a number is, since the alternative is a table of NaNs.
 */
const clocCountsSchema = z
  .object({
    code: z.number(),
    comment: z.number(),
    blank: z.number(),
  })
  .loose()

/**
 * cloc's `--diff --by-file --json` shape: one section per change kind, each
 * keyed by repo-relative path. Every changed path appears in all of them,
 * zeroed where that kind didn't apply, so the sections share one file set.
 * `SUM` and `header` sit among the per-file entries and are not files.
 */
const clocDiffReportSchema = z
  .object({
    added: z.record(z.string(), clocCountsSchema).optional(),
    modified: z.record(z.string(), clocCountsSchema).optional(),
    removed: z.record(z.string(), clocCountsSchema).optional(),
  })
  .loose()

/** One cloc tally. `nFiles` is always 0 in `--by-file` mode, so it goes unread. */
export type ClocCounts = z.infer<typeof clocCountsSchema>
export type ClocDiffReport = z.infer<typeof clocDiffReportSchema>

async function assertPerl(): Promise<void> {
  const code = await exec('perl', ['--version'], {
    ignoreReturnCode: true,
    silent: true,
  })
  if (code !== 0) {
    throw new Error(
      'cloc is a perl script and no working `perl` was found on this runner.'
    )
  }
}

/**
 * Counts one revision range, returning cloc's per-file diff. Resolves to an
 * empty report when the range holds nothing cloc can count -- it writes no file
 * at all in that case rather than an empty one.
 */
export async function runClocDiff(options: {
  baseSha: string
  headSha: string
  reportPath: string
  /** Where to run git from. Defaults to the process's own directory. */
  cwd?: string
}): Promise<ClocDiffReport> {
  const { baseSha, headSha, cwd, reportPath } = options

  await assertPerl()
  const clocPath = await downloadCloc()

  await exec(
    'perl',
    [
      clocPath,
      '--git',
      '--diff',
      baseSha,
      headSha,
      '--by-file',
      '--json',
      `--report-file=${reportPath}`,
    ],
    { cwd }
  )

  // How cloc signals "nothing countable here" depends on its version: 2.10
  // writes `{}`, 2.06 wrote no file at all. Tolerate the absent file so the pin
  // can move either way, but keep it apart from a file that will not parse or
  // whose counts are not numbers -- those are real failures, and must not be
  // reported as a count of zero.
  const raw = await readFile(reportPath, 'utf8').catch(() => null)
  if (raw === null) {
    info(
      'cloc produced no report — treating the range as holding no countable lines.'
    )
    return {}
  }

  return clocDiffReportSchema.parse(JSON.parse(raw))
}
