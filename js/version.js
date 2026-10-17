'use strict';

// APP_VERSION is the internal build number - bump it on every deploy. Read by both the page and
// the service worker (which pulls it in via importScripts), so the cache name and the build shown
// in the app can never drift apart.
//
// RELEASE_VERSION is the version people see (1.0, 1.0.1, ...). Bump it for each release, with a
// matching entry at the top of CHANGELOG (js/changelog.js) - that's what drives "What's new".
const APP_VERSION = 'v65';
const RELEASE_VERSION = '1.0.1';

// How the version is shown in the app: "1.0.1 (v59)".
const VERSION_LABEL = `${RELEASE_VERSION} (${APP_VERSION})`;
