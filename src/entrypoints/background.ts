import { defineBackground } from 'wxt/utils/define-background'
import { initializeBackground } from '~/background/main'

export default defineBackground({ type: 'module', main: initializeBackground })
