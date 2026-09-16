/**
 * @fileoverview Runs cloc over a revision range, and the shape it hands back --
 * cloc being the thing that actually knows a comment from a line of code.
 */

import { readFile } from 'node:fs/promises'
import { info } from '@actions/core'
import { exec } from '@actions/exec'

import { downloadCloc } from './download.ts'

/** One cloc tally. `nFiles` is always 0 in `--by-file` mode, so it goes unread. */
export type ClocCounts = {
  code: number
  comment: number
  blank: number
}

export const CHANGE_KINDS = ['added', 'modified', 'removed'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/**
 * cloc's `--diff --by-file --json` shape: one section per change kind, each
 * keyed by repo-relative path. Every changed path appears in all of them,
 * zeroed where that kind didn't apply, so the sections share one file set.
 * `SUM` and `header` sit among the per-file entries and are not files.
 */
export type ClocDiffReport = Partial<
  Record<ChangeKind, Record<string, ClocCounts>>
>

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
  cwd: string
  reportPath: string
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

  try {
    return JSON.parse(await readFile(reportPath, 'utf8')) as ClocDiffReport
  } catch {
    info(
      'cloc produced no report — treating the range as holding no countable lines.'
    )
    return {}
  }
}
