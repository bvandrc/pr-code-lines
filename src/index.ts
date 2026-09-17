/**
 * @fileoverview Action entrypoint: counts the resolved range with cloc, sorts
 * the changed files into categories, and reports the tally as outputs and a
 * job summary.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getInput, info, setFailed, setOutput, summary } from '@actions/core'
import { context } from '@actions/github'

import { runClocDiff } from './cloc/run.ts'
import { githubDiffTotalsSchema, renderMarkdown } from './markdown.ts'
import { resolveShaRange } from './sha.ts'
import { DEFAULT_CATEGORY_GLOBS, tallyDiff } from './tally.ts'

async function run(): Promise<void> {
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

  const tally = tallyDiff(report, DEFAULT_CATEGORY_GLOBS)

  const markdown = renderMarkdown(tally, {
    // Empty when a caller passes `title: ''`; the default belongs to renderMarkdown.
    title: getInput('title') || undefined,
    // Present only on the pull_request event. The payload is typed `any`, so the
    // schema is what checks it -- and strips the other ~50 keys.
    githubTotals: githubDiffTotalsSchema.safeParse(pullRequest).data,
  })

  setOutput('markdown', markdown)
  setOutput('json', JSON.stringify(tally))

  await summary.addRaw(markdown).write()
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error))
})
