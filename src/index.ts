/**
 * @fileoverview Action entrypoint: counts the resolved range with cloc, sorts
 * the changed files into categories, and reports the tally as outputs, a job
 * summary and a pull request comment.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput,
  summary,
} from '@actions/core'
import { context, getOctokit } from '@actions/github'

import { runClocDiff } from './cloc/run.ts'
import { githubDiffTotalsSchema, renderMarkdown } from './markdown.ts'
import { resolveShaRange } from './sha.ts'
import { DEFAULT_CATEGORY_GLOBS, tallyDiff } from './tally.ts'

/** Edits one comment in place across pushes instead of leaving a trail of them. */
async function postStickyComment(body: string, header: string): Promise<void> {
  const token = getInput('github-token')
  const pullRequest = context.payload.pull_request
  if (!pullRequest) {
    info('Not a pull request — skipping the comment.')
    return
  }

  const marker = `<!-- pr-code-lines: ${header} -->`
  const octokit = getOctokit(token)
  const { owner, repo } = context.repo
  const issue_number = pullRequest.number

  const existing = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  })
  const previous = existing.find((comment) => comment.body?.includes(marker))
  const withMarker = `${body}\n\n${marker}`

  if (previous) {
    if (previous.body === withMarker) {
      info('Comment is already up to date.')
      return
    }
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: previous.id,
      body: withMarker,
    })
    return
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number,
    body: withMarker,
  })
}

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

  if (getBooleanInput('comment')) {
    await postStickyComment(markdown, getInput('comment-header'))
  }
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error))
})
