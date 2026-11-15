import { LOCAL_REPOLENS_ORIGIN, resolveRepoLensOrigin } from '../../../scripts/repolens-origin'

describe('repolens build origin', () => {
  it('uses the explicit loopback development origin by default', () => {
    expect(resolveRepoLensOrigin({})).toBe(LOCAL_REPOLENS_ORIGIN)
  })

  it('normalizes an exact HTTPS production origin', () => {
    expect(resolveRepoLensOrigin({
      REPOLENS_ORIGIN: 'https://repolens.example.com:8443',
      REPOLENS_REQUIRE_HTTPS: 'true',
    })).toBe('https://repolens.example.com:8443')
  })

  it.each([
    'http://repolens.example.com',
    'https://user:secret@repolens.example.com',
    'https://repolens.example.com/embed',
    'https://repolens.example.com?channel=stable',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  ])('rejects an unsafe or non-origin value: %s', (origin) => {
    expect(() => resolveRepoLensOrigin({ REPOLENS_ORIGIN: origin })).toThrow()
  })

  it('requires HTTPS when the release gate is enabled', () => {
    expect(() => resolveRepoLensOrigin({
      REPOLENS_ORIGIN: LOCAL_REPOLENS_ORIGIN,
      REPOLENS_REQUIRE_HTTPS: 'true',
    })).toThrow('must use HTTPS for a release build')
  })
})
