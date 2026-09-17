/**
 * @fileoverview Action entrypoint: counts the resolved range with cloc, sorts
 * the changed files into categories, and exposes the tally as one output.
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

/**
 * `<name>-patterns` replaces the defaults; `extra-<name>-patterns` adds to
 * whichever list is in force. Both, and a workflow can swap one category
 * wholesale while only extending another.
 */
const globsFor = (name: string): string[] => [
  ...readGlobs(`${name}-patterns`),
  ...readGlobs(`extra-${name}-patterns`),
]

async function run(): Promise<void> {
  const globs: CategoryGlobs = {
    tests: globsFor('test'),
    generated: globsFor('generated'),
    docs: globsFor('docs'),
    config: globsFor('config'),
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

  setOutput('json', JSON.stringify(tallyDiff(report, globs)))
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error))
})
