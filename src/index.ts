/**
 * @fileoverview Action entrypoint: counts the resolved range with cloc, sorts
 * the changed files into categories, and exposes the tallies as outputs.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getInput, info, setFailed, setOutput } from '@actions/core'
import { context } from '@actions/github'

import { runClocDiff } from './cloc/run.ts'
import { resolveShaRange } from './sha.ts'
import { type CategoryGlobs, tallyDiff } from './tally.ts'

/** One glob per line, so a workflow can write the list the way YAML reads it. */
const readGlobs = (name: string): string[] =>
  getInput(name)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

async function run(): Promise<void> {
  const globs: CategoryGlobs = {
    tests: readGlobs('test-patterns'),
    generated: readGlobs('generated-patterns'),
    docs: readGlobs('docs-patterns'),
  }

  const pullRequest = context.payload.pull_request
  const { baseSha, headSha } = await resolveShaRange({
    base: getInput('base-sha') || pullRequest?.base?.sha,
    head: getInput('head-sha') || pullRequest?.head?.sha,
  })
  info(`Counting ${baseSha}..${headSha}`)

  const report = await runClocDiff({
    baseSha,
    headSha,
    reportPath: join(tmpdir(), 'pr-code-lines.json'),
  })

  const tally = tallyDiff(report, globs)

  const source = tally.byCategory.find(
    ([category]) => category === 'SOURCE'
  )?.[1]
  setOutput('source-code-added', source?.added.code ?? 0)
  setOutput('source-code-modified', source?.modified.code ?? 0)
  setOutput('source-code-removed', source?.removed.code ?? 0)
  setOutput('code-added', tally.total.added.code)
  setOutput('code-modified', tally.total.modified.code)
  setOutput('code-removed', tally.total.removed.code)
  setOutput('comment-added', tally.total.added.comment)
  setOutput('comment-removed', tally.total.removed.comment)
  setOutput('json', JSON.stringify(tally))
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error))
})
