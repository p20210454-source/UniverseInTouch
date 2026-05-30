/**
 * Resolves site and API URLs for localhost and GitHub project Pages (/RepoName/).
 * Load synchronously before other scripts.
 */
(function (global) {
  'use strict';

  function detectSiteBase() {
    var host = global.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return '/';
    if (host === 'github.io' || host.slice(-10) === '.github.io') {
      var parts = global.location.pathname.split('/').filter(Boolean);
      if (parts.length && !/\.[a-z0-9]+$/i.test(parts[0])) {
        return '/' + parts[0] + '/';
      }
    }
    return '/';
  }

  var SITE_BASE = detectSiteBase();

  function siteUrl(rel) {
    rel = String(rel || '').replace(/^\//, '');
    if (!rel) return SITE_BASE === '/' ? '/' : SITE_BASE;
    return SITE_BASE + rel;
  }

  function apiUrl(path) {
    if (path.charAt(0) !== '/') path = '/' + path;
    return path;
  }

  global.SITE_BASE = SITE_BASE;
  global.siteUrl = siteUrl;
  global.apiUrl = apiUrl;
  global.IS_STATIC_PAGES =
    global.location.hostname === 'github.io' ||
    global.location.hostname.slice(-10) === '.github.io';
})(typeof window !== 'undefined' ? window : this);
