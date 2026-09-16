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
import { z } from 'zod'

const PIN_FILE = new URL('../src/cloc/pin.json', import.meta.url)
const LATEST_RELEASE =
  'https://api.github.com/repos/AlDanial/cloc/releases/latest'

const pinSchema = z.object({
  version: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'must be a 64-character hex digest'),
})

type Pin = z.infer<typeof pinSchema>

/** Reads a pin, or says which field is wrong rather than failing later on a 404. */
async function readPin(): Promise<Pin> {
  const parsed = pinSchema.safeParse(
    JSON.parse(await readFile(PIN_FILE, 'utf8'))
  )
  if (!parsed.success) {
    throw new Error(
      `${PIN_FILE.pathname} is not a valid pin:\n${z.prettifyError(parsed.error)}`
    )
  }

  return parsed.data
}

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
  const pin = await readPin()

  const latest = await latestVersion()
  if (latest === pin.version) {
    console.log(`cloc is pinned to the latest release (v${pin.version}).`)
    await report({ outdated: 'false', version: pin.version })
    return
  }

  // Download before rewriting: a release whose asset is missing or unreadable
  // should leave the pin alone rather than half-updated.
  const sha256 = await sha256Of(scriptUrl(latest))

  // Validated on the way out too: this runs unattended, and a malformed pin
  // committed to a branch would fail every consumer rather than just this job.
  const next = pinSchema.parse({ version: latest, sha256 })
  await writeFile(PIN_FILE, `${JSON.stringify(next, null, 2)}\n`)

  console.log(`cloc v${pin.version} -> v${latest} (sha256 ${sha256})`)
  await report({ outdated: 'true', version: latest, previous: pin.version })
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
