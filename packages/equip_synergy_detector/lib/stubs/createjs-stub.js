/**
 * Lightweight CreateJS (TweenJS) stub for running KCS scripts in Node.js.
 * Provides Tween, Timeline, Ticker, and Ease stubs.
 */

const EventEmitter = require('events');

// ── Ease functions (all return identity or simple easing) ─────────

function makeEase(fn) { return fn || function (t) { return t; }; }
function makePowEase(pow) { return function (t) { return Math.pow(t, pow); }; }

const Ease = {
  linear: function (t) { return t; },
  quadIn: makePowEase(2),
  quadOut: function (t) { return 1 - Math.pow(1 - t, 2); },
  quadInOut: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
  cubicIn: makePowEase(3),
  cubicOut: function (t) { return 1 - Math.pow(1 - t, 3); },
  cubicInOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  quartIn: makePowEase(4),
  quartOut: function (t) { return 1 - Math.pow(1 - t, 4); },
  quartInOut: function (t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; },
  quintIn: makePowEase(5),
  quintOut: function (t) { return 1 - Math.pow(1 - t, 5); },
  quintInOut: function (t) { return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2; },
  sineIn: function (t) { return 1 - Math.cos(t * Math.PI / 2); },
  sineOut: function (t) { return Math.sin(t * Math.PI / 2); },
  sineInOut: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
  circIn: function (t) { return 1 - Math.sqrt(1 - t * t); },
  circOut: function (t) { return Math.sqrt(1 - Math.pow(t - 1, 2)); },
  circInOut: function (t) { return t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2; },
  backIn: function (t) { return 2.70158 * t * t * t - 1.70158 * t * t; },
  backOut: function (t) { return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); },
  backInOut: function (t) { return t; },
  bounceIn: function (t) { return t; },
  bounceOut: function (t) { return t; },
  bounceInOut: function (t) { return t; },
  elasticIn: function (t) { return t; },
  elasticOut: function (t) { return t; },
  elasticInOut: function (t) { return t; },
  getBackIn: function () { return Ease.backIn; },
  getBackOut: function () { return Ease.backOut; },
  getElasticOut: function () { return Ease.elasticOut; },
  getPowIn: function () { return function (t) { return t; }; },
  getPowOut: function () { return function (t) { return t; }; },
};

// ── Tween ─────────────────────────────────────────────────────────

class Tween {
  constructor(target, props) {
    this._target = target;
    this._steps = [];
    this.loop = (props && props.loop) || 0;
  }
  to(props, duration, ease) { return this; }
  wait(duration) { return this; }
  call(callback, params, scope) {
    if (callback) {
      try { callback.apply(scope, params); } catch (_) {}
    }
    return this;
  }
  set(props) {
    if (this._target && props) {
      Object.assign(this._target, props);
    }
    return this;
  }
  play() { return this; }
  pause() { return this; }
  setPaused(paused) { return this; }
  addEventListener(type, listener) {}
  removeEventListener(type, listener) {}

  static get(target, props) { return new Tween(target, props); }
  static removeTweens(target) {}
  static removeAllTweens() {}
  static hasActiveTweens(target) { return false; }
}
Tween.LOOP = 1;

// ── Timeline ──────────────────────────────────────────────────────

class Timeline {
  constructor(tweens, labels, props) {
    this.tweens = tweens || [];
  }
  addTween(...tweens) { this.tweens.push(...tweens); return this; }
  removeTween(...tweens) { return this; }
  gotoAndPlay(pos) {}
  gotoAndStop(pos) {}
  setPaused(paused) {}
  addEventListener(type, listener) {}
  removeEventListener(type, listener) {}
}

// ── Ticker ────────────────────────────────────────────────────────

const Ticker = {
  TIMEOUT: 'timeout',
  timingMode: 'timeout',
  framerate: 60,
  _listeners: {},
  addEventListener(type, listener) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  },
  removeEventListener(type, listener) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(l => l !== listener);
  },
  setFPS(fps) { this.framerate = fps; },
  getFPS() { return this.framerate; },
  setPaused(paused) {},
};

// ── Export ─────────────────────────────────────────────────────────

const createjs = { Ease, Tween, Timeline, Ticker };
module.exports = createjs;
