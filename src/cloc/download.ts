/**
 * @fileoverview Gets the cloc script onto the runner, and refuses to hand back
 * one that isn't byte-for-byte the release we pinned.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { debug } from '@actions/core'
import { cacheFile, downloadTool, find } from '@actions/tool-cache'

import pin from './pin.json' with { type: 'json' }

/**
 * The pinned release lives in `pin.json` rather than here so that
 * `script/check-cloc-version.ts` can move it by rewriting data instead of
 * patching this file's source.
 *
 * It is upstream's release script, pinned by URL and checksum, rather than the
 * `cloc` npm package. That package's own version numbers are unrelated to the
 * tool's: installing `cloc@2.06` from the registry gets you cloc *1.86*, which
 * reads a rename as a whole file added plus a whole file deleted, overstating a
 * rename by the file's entire length. (That 2.06 is the registry's number and
 * has nothing to do with the pinned version.)
 */
const CLOC_URL = `https://github.com/AlDanial/cloc/releases/download/v${pin.version}/cloc-${pin.version}.pl`

/**
 * Resolves to the path of the pinned cloc script, downloading it on first use
 * and reusing the runner's tool cache afterwards. Throws rather than returning
 * a script whose checksum doesn't match.
 */
export async function downloadCloc(): Promise<string> {
  const cached = find('cloc', pin.version)
  if (cached) return join(cached, 'cloc.pl')

  debug(`Downloading ${CLOC_URL}`)
  const downloaded = await downloadTool(CLOC_URL)

  const actual = createHash('sha256')
    .update(await readFile(downloaded))
    .digest('hex')
  if (actual !== pin.sha256) {
    throw new Error(
      `cloc checksum mismatch: expected ${pin.sha256}, got ${actual}. Refusing to run it.`
    )
  }

  const dir = await cacheFile(downloaded, 'cloc.pl', 'cloc', pin.version)
  return join(dir, 'cloc.pl')
}
