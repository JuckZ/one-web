/** Applied by the manifest to the packaged loader, which has an opaque origin. */
export const MINI_APP_SANDBOX_CSP = 'sandbox allow-scripts; default-src \'none\'; script-src \'self\' \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; frame-src \'self\' about:; child-src \'self\' about:; worker-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\''

/** Inherited manifest policy is further restricted before any generated markup is parsed. */
export const MINI_APP_DOCUMENT_CSP = 'default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; frame-src \'none\'; child-src \'none\'; worker-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; media-src \'none\'; font-src \'none\''
export const MINI_APP_RUNNER_CHANNEL = 'oneweb.mini-app.v1'
