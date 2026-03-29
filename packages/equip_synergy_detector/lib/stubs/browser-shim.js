/**
 * Browser environment shim for running KCS scripts in Node.js.
 * Provides window, document, navigator, and other browser globals via jsdom.
 */
const { JSDOM } = require('jsdom');

function createBrowserEnv() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="game_frame"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
    // resources: 'usable' は削除 — 外部リソース取得を無効化
  });

  const window = dom.window;
  const document = window.document;

  // Polyfill APIs that jsdom doesn't provide
  if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, params) {
        super(type, params);
      }
    };
  }

  // canvas element stub (createElement("canvas") is used by PixiJS)
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName, options) {
    const el = origCreateElement(tagName, options);
    if (tagName.toLowerCase() === 'canvas') {
      if (!el.getContext) {
        el.getContext = function () { return null; };
      }
    }
    return el;
  };

  // ── Block network APIs on window ────────────────────────────────
  window.fetch = function (url) {
    console.log(`[browser-shim] Blocked fetch: ${url}`);
    return Promise.resolve(new window.Response('', { status: 200, statusText: 'blocked' }));
  };

  const origXHROpen = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url) {
    console.log(`[browser-shim] Blocked XMLHttpRequest: ${method} ${url}`);
    this._blocked = true;
    return origXHROpen.apply(this, arguments);
  };
  const origXHRSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.send = function () {
    if (this._blocked) return;
    return origXHRSend.apply(this, arguments);
  };

  return { dom, window, document };
}

module.exports = { createBrowserEnv };
