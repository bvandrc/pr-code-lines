/**
 * @fileoverview Action entrypoint: counts the resolved range with cloc and
 * exposes the per-file result as an output.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { info, setFailed, setOutput } from '@actions/core'

import { runClocDiff } from './cloc/run.ts'
import { resolveShaRange } from './sha.ts'

async function run(): Promise<void> {
  const { baseSha, headSha } = await resolveShaRange()
  info(`Counting ${baseSha}..${headSha}`)

  const report = await runClocDiff({
    baseSha,
    headSha,
    cwd: process.cwd(),
    reportPath: join(tmpdir(), 'pr-code-lines.json'),
  })

  setOutput('json', JSON.stringify(report))
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error))
})
