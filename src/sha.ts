/**
 * @fileoverview Works out which two revisions the run should count, from the
 * event that triggered it or from explicit inputs.
 */

import { getInput } from '@actions/core'
import { exec } from '@actions/exec'
import { context } from '@actions/github'

export type ShaRange = {
  baseSha: string
  headSha: string
}

/**
 * Resolves the range to count, taking the pull request's base and head unless
 * `base-sha` and `head-sha` override them. `baseSha` comes back as the merge
 * base of the two, not the base branch's tip: diffing the tip would bill a pull
 * request for commits that landed on the base after it forked. GitHub's own +/-
 * counts from the merge base too, so this keeps the two comparable.
 *
 * Throws when there is nothing to compare, or when the merge base is missing --
 * which a shallow clone causes, since it holds the two tips but not their
 * common ancestor.
 */
export async function resolveShaRange(): Promise<ShaRange> {
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
    throw new Error(
      `Could not find a merge base for ${baseInput}...${headInput}. Check out with \`fetch-depth: 0\`.`
    )
  }

  return { baseSha: mergeBase.trim(), headSha: headInput }
}
