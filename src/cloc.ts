/**
 * @fileoverview Fetches and runs cloc, the thing that actually knows a comment
 * from a line of code.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { debug, info } from '@actions/core'
import { exec } from '@actions/exec'
import { cacheFile, downloadTool, find } from '@actions/tool-cache'

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

/**
 * Upstream's release script, pinned by URL and checksum, rather than the `cloc`
 * npm package: that package's version numbers are decoupled from the tool's, so
 * `cloc@2.06` installs cloc 1.86 -- which reads a rename as a whole file added
 * plus a whole file deleted, overstating a rename by the file's entire length.
 */
const CLOC_VERSION = '2.06'
const CLOC_URL = `https://github.com/AlDanial/cloc/releases/download/v${CLOC_VERSION}/cloc-${CLOC_VERSION}.pl`
const CLOC_SHA256 =
  'ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8'

async function downloadCloc(): Promise<string> {
  const cached = find('cloc', CLOC_VERSION)
  if (cached) return join(cached, 'cloc.pl')

  debug(`Downloading ${CLOC_URL}`)
  const downloaded = await downloadTool(CLOC_URL)

  const actual = createHash('sha256')
    .update(await readFile(downloaded))
    .digest('hex')
  if (actual !== CLOC_SHA256) {
    throw new Error(
      `cloc checksum mismatch: expected ${CLOC_SHA256}, got ${actual}. Refusing to run it.`
    )
  }

  const dir = await cacheFile(downloaded, 'cloc.pl', 'cloc', CLOC_VERSION)
  return join(dir, 'cloc.pl')
}

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
