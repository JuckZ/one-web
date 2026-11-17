import { UserscriptController } from './controller'
import { getUserscriptManager } from './gm'

const runtimeKey = '__onewebUserscriptActiveV1' as const
// The marker exposes no controller, manager callback or authority to page code.
const scope = globalThis as typeof globalThis & { [runtimeKey]?: boolean }

if (!scope[runtimeKey] && window.top === window && /^https?:$/.test(window.location.protocol)) {
  const manager = getUserscriptManager()
  if (manager) {
    scope[runtimeKey] = true
    const controller = new UserscriptController(document, manager)
    void controller.start()
  }
  else {
    console.warn('OneWeb: 请通过支持所需 GM API 的油猴插件安装此脚本。')
  }
}
