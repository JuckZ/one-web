import { DUBBING_PORT } from '~/modules/builtin/video-dubbing/contracts'
import { findDubbingVideo } from '~/modules/builtin/video-dubbing/html5'
import { dubbingSite } from '~/modules/builtin/video-dubbing/sites'
import browser from '~/platform/browser'
import { createPlayerMedia, decodeDuration } from './media'
import { mountDubbingPlayer } from './player'

const scope = globalThis as typeof globalThis & { __onewebVideoDubbingStop?: () => void }
scope.__onewebVideoDubbingStop?.()
const site = dubbingSite(location.href)
const video = site ? findDubbingVideo(site.platform) : null
if (video && site) {
  const videoId = site.videoId
  let source = video.currentSrc || video.src
  const port = browser.runtime.connect({ name: DUBBING_PORT })
  const player = mountDubbingPlayer({ video, port, media: createPlayerMedia(video), decode: decodeDuration })
  let disposed = false
  const timer = setInterval(() => {
    if (
      !video.isConnected
      || findDubbingVideo(site.platform) !== video
      || dubbingSite(location.href)?.videoId !== videoId
      || (site.platform !== 'youtube' && !!source && !!(video.currentSrc || video.src) && (video.currentSrc || video.src) !== source)
    ) {
      stop()
    }
    source ||= video.currentSrc || video.src
  }, 250)
  function stop() {
    if (disposed)
      return
    disposed = true
    clearInterval(timer)
    window.removeEventListener('pagehide', stop)
    player.destroy()
    try {
      port.disconnect()
    }
    catch {}
    delete scope.__onewebVideoDubbingStop
  }
  port.onDisconnect.addListener(stop)
  window.addEventListener('pagehide', stop, { once: true })
  scope.__onewebVideoDubbingStop = stop
}
