/// <reference types="chrome"/>
/// <reference path="./loglevel.d.ts" />

declare const __DEV__: boolean
/** Whether the current artifact targets Firefox. */
declare const __FIREFOX__: boolean
/** Extension name, defined in packageJson.name */
declare const __NAME__: string
/** Exact RepoLens origin fixed into the extension at build time. */
declare const __REPOLENS_ORIGIN__: string
