import fs from 'fs-extra'
import { getManifest } from '../src/manifest'
import { e, log } from './utils'

export async function writeManifest() {
  await fs.ensureDir(e())
  await fs.writeJSON(e('manifest.json'), await getManifest(), { spaces: 2 })
  log('PRE', 'write manifest.json')
}

writeManifest()
