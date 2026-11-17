export type UserscriptMenuId = number | string
export type MaybePromise<Value> = Value | Promise<Value>

/** Only the finite manager APIs used by this target. No page/window bridge. */
export interface UserscriptManager {
  get: (_key: string, _fallback: unknown) => MaybePromise<unknown>
  set: (_key: string, _value: unknown) => MaybePromise<void>
  delete: (_key: string) => MaybePromise<void>
  menu: (_title: string, _callback: () => void) => UserscriptMenuId
  removeMenu: (_id: UserscriptMenuId) => void
  listen: (_key: string, _callback: (_remote: boolean) => void) => number
  unlisten: (_id: number) => void
}

declare const GM_getValue: (_key: string, _fallback: unknown) => unknown
declare const GM_setValue: (_key: string, _value: unknown) => void
declare const GM_deleteValue: (_key: string) => void
declare const GM_registerMenuCommand: (_title: string, _callback: () => void) => UserscriptMenuId
declare const GM_unregisterMenuCommand: (_id: UserscriptMenuId) => void
declare const GM_addValueChangeListener: (
  _key: string,
  _callback: (_key: string, _previous: unknown, _next: unknown, _remote: boolean) => void,
) => number
declare const GM_removeValueChangeListener: (_id: number) => void

export function getUserscriptManager(): UserscriptManager | null {
  if (typeof GM_getValue !== 'function'
    || typeof GM_setValue !== 'function'
    || typeof GM_deleteValue !== 'function'
    || typeof GM_registerMenuCommand !== 'function'
    || typeof GM_unregisterMenuCommand !== 'function'
    || typeof GM_addValueChangeListener !== 'function'
    || typeof GM_removeValueChangeListener !== 'function') {
    return null
  }
  return {
    get: (key, fallback) => GM_getValue(key, fallback),
    set: (key, value) => GM_setValue(key, value),
    delete: key => GM_deleteValue(key),
    menu: (title, callback) => GM_registerMenuCommand(title, callback),
    removeMenu: id => GM_unregisterMenuCommand(id),
    listen: (key, callback) => GM_addValueChangeListener(key, (_key, _previous, _next, remote) => callback(remote)),
    unlisten: id => GM_removeValueChangeListener(id),
  }
}
