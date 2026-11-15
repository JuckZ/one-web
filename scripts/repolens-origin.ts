import process from 'node:process'

export const LOCAL_REPOLENS_ORIGIN = 'http://127.0.0.1:4747'

type RepoLensOriginEnvironment = Readonly<Record<string, string | undefined>>

function isLoopbackHostname(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

export function resolveRepoLensOrigin(
  environment: RepoLensOriginEnvironment = process.env,
) {
  const configured = environment.REPOLENS_ORIGIN?.trim() || LOCAL_REPOLENS_ORIGIN
  let url: URL
  try {
    url = new URL(configured)
  }
  catch {
    throw new Error('REPOLENS_ORIGIN must be an absolute HTTP(S) origin')
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('REPOLENS_ORIGIN must contain only an HTTP(S) scheme, host, and optional port')
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('REPOLENS_ORIGIN allows HTTP only for an explicit loopback host')
  }
  if (environment.REPOLENS_REQUIRE_HTTPS === 'true' && url.protocol !== 'https:') {
    throw new Error('REPOLENS_ORIGIN must use HTTPS for a release build')
  }
  return url.origin
}
