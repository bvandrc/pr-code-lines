/**
 * @fileoverview Keeps one pull request comment up to date, rather than adding
 * another on every push.
 */

import { getInput, info } from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { pick } from 'es-toolkit'

/** Identifies our comment among the others on the pull request. */
const MARKER = '<!-- pr-code-lines -->'

/** Edits one comment in place across pushes instead of leaving a trail of them. */
export async function postStickyComment({
  body,
}: {
  body: string
}): Promise<void> {
  const token = getInput('github-token')
  const pullRequest = context.payload.pull_request
  if (!pullRequest) {
    info('Not a pull request — skipping the comment.')
    return
  }

  const octokit = getOctokit(token)
  // Picked rather than spread whole: a spread would silently carry any field
  // a future @actions/github adds to context.repo, since excess property
  // checks do not apply through one.
  const repo = pick(context.repo, ['owner', 'repo'])
  const issue_number = pullRequest.number

  const existing = await octokit.paginate(octokit.rest.issues.listComments, {
    ...repo,
    issue_number,
    per_page: 100,
  })
  const previous = existing.find((comment) => comment.body?.includes(MARKER))
  const withMarker = `${body}\n\n${MARKER}`

  if (previous) {
    if (previous.body === withMarker) {
      info('Comment is already up to date.')
      return
    }
    await octokit.rest.issues.updateComment({
      ...repo,
      comment_id: previous.id,
      body: withMarker,
    })
    return
  }

  await octokit.rest.issues.createComment({
    ...repo,
    issue_number,
    body: withMarker,
  })
}
