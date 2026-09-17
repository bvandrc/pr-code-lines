/**
 * @fileoverview Keeps one pull request comment up to date, rather than adding
 * another on every push.
 */

import { getInput, info } from '@actions/core'
import { context, getOctokit } from '@actions/github'

/** Edits one comment in place across pushes instead of leaving a trail of them. */
export async function postStickyComment({
  body,
  header,
}: {
  body: string
  header: string
}): Promise<void> {
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
