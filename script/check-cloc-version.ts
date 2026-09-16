/**
 * @fileoverview Compares the pinned cloc release against upstream's latest and,
 * when they differ, rewrites the pin in place — version and checksum together,
 * since a pin carrying one without the other fails at runtime.
 *
 * Run by `.github/workflows/cloc-version.yml`, which opens a pull request from
 * whatever this rewrites. Safe to run by hand: `npm run cloc:check`.
 */

import { createHash } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

const PIN_FILE = new URL('../src/cloc/download.ts', import.meta.url)
const LATEST_RELEASE =
  'https://api.github.com/repos/AlDanial/cloc/releases/latest'

const VERSION_PATTERN = /const CLOC_VERSION = '([\d.]+)'/
const SHA_PATTERN = /const CLOC_SHA256 =\n\s*'([a-f0-9]{64})'/

const scriptUrl = (version: string) =>
  `https://github.com/AlDanial/cloc/releases/download/v${version}/cloc-${version}.pl`

/** Upstream tags releases `v2.10`; the pin and the asset name both drop the `v`. */
async function latestVersion(): Promise<string> {
  const response = await fetch(LATEST_RELEASE, {
    headers: {
      accept: 'application/vnd.github+json',
      // Lifts the anonymous rate limit when the workflow passes one through.
      ...(process.env.GITHUB_TOKEN
        ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })
  if (!response.ok) {
    throw new Error(`Could not read cloc's latest release: ${response.status}`)
  }

  const { tag_name } = (await response.json()) as { tag_name?: string }
  if (!tag_name) throw new Error("cloc's latest release has no tag name")

  return tag_name.replace(/^v/, '')
}

async function sha256Of(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not download ${url}: ${response.status}`)
  }

  return createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex')
}

/** Lets the workflow decide whether to open a pull request without parsing logs. */
async function report(outputs: Record<string, string>): Promise<void> {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return

  await appendFile(
    file,
    `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  )
}

async function run(): Promise<void> {
  const source = await readFile(PIN_FILE, 'utf8')
  const pinned = source.match(VERSION_PATTERN)?.[1]
  if (!pinned) throw new Error(`No CLOC_VERSION found in ${PIN_FILE.pathname}`)
  if (!SHA_PATTERN.test(source)) {
    throw new Error(`No CLOC_SHA256 found in ${PIN_FILE.pathname}`)
  }

  const latest = await latestVersion()
  if (latest === pinned) {
    console.log(`cloc is pinned to the latest release (v${pinned}).`)
    await report({ outdated: 'false', version: pinned })
    return
  }

  // Download before rewriting: a release whose asset is missing or unreadable
  // should leave the pin alone rather than half-updated.
  const sha256 = await sha256Of(scriptUrl(latest))

  await writeFile(
    PIN_FILE,
    source
      .replace(VERSION_PATTERN, `const CLOC_VERSION = '${latest}'`)
      .replace(SHA_PATTERN, `const CLOC_SHA256 =\n  '${sha256}'`)
  )

  console.log(`cloc v${pinned} -> v${latest} (sha256 ${sha256})`)
  await report({ outdated: 'true', version: latest, previous: pinned })
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
