/**
 * @fileoverview Compares the pinned cloc release against upstream's latest and,
 * when they differ, rewrites `src/cloc/pin.json` — version and checksum
 * together, since a pin carrying one without the other fails at runtime.
 *
 * Run by `.github/workflows/cloc-version.yml`, which opens a pull request from
 * whatever this rewrites. Safe to run by hand: `npm run cloc:check`.
 */

import { createHash } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'

const PIN_FILE = new URL('../src/cloc/pin.json', import.meta.url)
const LATEST_RELEASE =
  'https://api.github.com/repos/AlDanial/cloc/releases/latest'

type Pin = { version: string; sha256: string }

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
  const pin = JSON.parse(await readFile(PIN_FILE, 'utf8')) as Pin
  if (typeof pin.version !== 'string' || typeof pin.sha256 !== 'string') {
    throw new Error(`${PIN_FILE.pathname} is not a { version, sha256 } pin`)
  }

  const latest = await latestVersion()
  if (latest === pin.version) {
    console.log(`cloc is pinned to the latest release (v${pin.version}).`)
    await report({ outdated: 'false', version: pin.version })
    return
  }

  // Download before rewriting: a release whose asset is missing or unreadable
  // should leave the pin alone rather than half-updated.
  const sha256 = await sha256Of(scriptUrl(latest))

  const next: Pin = { version: latest, sha256 }
  await writeFile(PIN_FILE, `${JSON.stringify(next, null, 2)}\n`)

  console.log(`cloc v${pin.version} -> v${latest} (sha256 ${sha256})`)
  await report({ outdated: 'true', version: latest, previous: pin.version })
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
