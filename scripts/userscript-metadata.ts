import { stableVersion } from './release-version'

export const USERSCRIPT_DOWNLOAD_URL = 'https://github.com/JuckZ/one-web/releases/latest/download/one-web.user.js'
export const USERSCRIPT_UPDATE_URL = 'https://github.com/JuckZ/one-web/releases/latest/download/one-web.meta.js'

export function userscriptMetadata(version: string) {
  return `// ==UserScript==
// @name         OneWeb
// @namespace    https://github.com/JuckZ/one-web
// @version      ${stableVersion(version)}
// @description  当前网页的轻量工具；逐站启用，设置由油猴插件保管。
// @author       Juck
// @license      MIT
// @homepageURL  https://github.com/JuckZ/one-web
// @supportURL   https://github.com/JuckZ/one-web/issues
// @downloadURL  ${USERSCRIPT_DOWNLOAD_URL}
// @updateURL    ${USERSCRIPT_UPDATE_URL}
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @noframes
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// ==/UserScript==\n`
}

export function validateUserscriptPair(user: string, meta: string, version: string) {
  const expected = userscriptMetadata(version)
  if (meta !== expected || !user.startsWith(expected))
    throw new Error('Userscript and metadata must share the canonical version, identity, URLs and grants')
  const body = user.slice(expected.length)
  if (body.trim().length < 100 || /\b(?:eval|fetch)\s*\(|new Function\b|\b(?:chrome|browser)\.(?:runtime|storage|tabs|scripting|permissions)\b|^import\s|^export\s/m.test(body))
    throw new Error('Userscript runtime is empty or crosses the standalone boundary')
}
