/**
 * @fileoverview Gets the cloc script onto the runner, and refuses to hand back
 * one that isn't byte-for-byte the release we pinned.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { debug } from '@actions/core'
import { cacheFile, downloadTool, find } from '@actions/tool-cache'

/**
 * Upstream's release script, pinned by URL and checksum, rather than the `cloc`
 * npm package. That package's own version numbers are unrelated to the tool's:
 * installing `cloc@2.06` from the registry gets you cloc *1.86*, which reads a
 * rename as a whole file added plus a whole file deleted, overstating a rename
 * by the file's entire length. (That 2.06 is the registry's number and has
 * nothing to do with CLOC_VERSION below, which is the tool's own release.)
 *
 * To move the pin: bump CLOC_VERSION, then set CLOC_SHA256 to the output of
 * `curl -fsSL <CLOC_URL> | sha256sum`, and run the tests -- they exercise the
 * real script, so a release that changed how it counts fails them here rather
 * than in someone's pull request.
 */
const CLOC_VERSION = '2.10'
const CLOC_URL = `https://github.com/AlDanial/cloc/releases/download/v${CLOC_VERSION}/cloc-${CLOC_VERSION}.pl`
const CLOC_SHA256 =
  'bf59272455172108072a0a106379f7509fd4349bdcfd85203bac038ccd286d83'

/**
 * Resolves to the path of the pinned cloc script, downloading it on first use
 * and reusing the runner's tool cache afterwards. Throws rather than returning
 * a script whose checksum doesn't match.
 */
export async function downloadCloc(): Promise<string> {
  const cached = find('cloc', CLOC_VERSION)
  if (cached) return join(cached, 'cloc.pl')

  debug(`Downloading ${CLOC_URL}`)
  const downloaded = await downloadTool(CLOC_URL)

  const actual = createHash('sha256')
    .update(await readFile(downloaded))
    .digest('hex')
  if (actual !== CLOC_SHA256) {
    throw new Error(
      `cloc checksum mismatch: expected ${CLOC_SHA256}, got ${actual}. Refusing to run it.`
    )
  }

  const dir = await cacheFile(downloaded, 'cloc.pl', 'cloc', CLOC_VERSION)
  return join(dir, 'cloc.pl')
}
