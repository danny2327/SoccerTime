'use strict';

// Single source of truth for the app's version - bump this on every deploy. Read by both the
// page (js/version.js) and the service worker (which pulls it in via importScripts) so the
// cache name and the version shown in Settings can never drift apart from each other.
const APP_VERSION = 'v31';
