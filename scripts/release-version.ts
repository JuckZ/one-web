/** One version grammar shared by npm, Chrome, Firefox and userscript releases. */
export function stableVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)
    || value.split('.').some(part => Number(part) > 65535) || value === '0.0.0') {
    throw new TypeError('Expected a stable three-part version (0..65535, nonzero, no leading zeros)')
  }
  return value
}

export function releaseTag(version: string, tag: string) {
  if (tag !== `v${stableVersion(version)}`)
    throw new TypeError('Release tag must equal v followed by the package version')
  return tag
}
