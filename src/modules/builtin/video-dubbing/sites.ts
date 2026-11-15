export type DubbingPlatform = 'youtube' | 'bilibili' | 'html5'

export function dubbingSite(value: string) {
  let url: URL
  try {
    url = new URL(value)
  }
  catch { return null }
  if (url.username || url.password || url.href.length > 4096
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    return null
  }
  const pattern = `${url.origin}/*`
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    const id = url.searchParams.get('v')
    if (url.pathname !== '/watch' || !id || !/^[\w-]{1,64}$/.test(id))
      return null
    return { platform: 'youtube' as const, origin: url.origin, pattern, origins: [pattern], videoId: id }
  }
  if (url.hostname === 'www.bilibili.com' || url.hostname === 'bilibili.com') {
    const match = /^\/video\/(BV[A-Za-z0-9]{10}|av[1-9]\d{0,15})\/?$/.exec(url.pathname)
    const part = url.searchParams.get('p') ?? '1'
    if (!match || !/^[1-9]\d{0,3}$/.test(part))
      return null
    return {
      platform: 'bilibili' as const,
      origin: url.origin,
      pattern,
      origins: [pattern, 'https://api.bilibili.com/*'],
      videoId: `bilibili:${match[1]}:${Number(part)}`,
    }
  }
  return { platform: 'html5' as const, origin: url.origin, pattern, origins: [pattern], videoId: `html5:${url.href}` }
}
