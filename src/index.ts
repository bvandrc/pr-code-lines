/**
 * @fileoverview Action entrypoint: works out which revision range the event
 * describes, counts it with cloc, and exposes the per-file result as an output.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getInput, info, setFailed, setOutput } from '@actions/core'
import { exec } from '@actions/exec'
import { context } from '@actions/github'

import { runClocDiff } from './cloc.ts'

/**
 * The merge base, not the base branch's tip: diffing the tip would bill this PR
 * for commits that landed on the base after it forked. GitHub's own +/- counts
 * from the merge base too, so this keeps the two comparable.
 */
async function resolveRange(): Promise<{ baseSha: string; headSha: string }> {
  const pullRequest = context.payload.pull_request
  const baseInput = getInput('base-sha') || pullRequest?.base?.sha
  const headInput = getInput('head-sha') || pullRequest?.head?.sha

  if (!baseInput || !headInput) {
    throw new Error(
      'No revisions to compare: run this on a `pull_request` event, or pass `base-sha` and `head-sha`.'
    )
  }

  let mergeBase = ''
  const code = await exec('git', ['merge-base', baseInput, headInput], {
    ignoreReturnCode: true,
    silent: true,
    listeners: { stdout: (data) => (mergeBase += data.toString()) },
  })

  if (code !== 0) {
    // Usually a shallow clone: the two tips are present but their common
    // ancestor was never fetched.
    throw new Error(
      `Could not find a merge base for ${baseInput}...${headInput}. Check out with \`fetch-depth: 0\`.`
    )
  }

  return { baseSha: mergeBase.trim(), headSha: headInput }
}

async function run(): Promise<void> {
  const { baseSha, headSha } = await resolveRange()
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
