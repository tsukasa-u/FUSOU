/**
 * Lightweight PIXI.js stub for running KCS scripts in Node.js.
 * Provides the class interfaces the KCS code depends on without actual rendering.
 */

const EventEmitter = require('events');

// ── Base classes ───────────────────────────────────────────────────

class DisplayObject extends EventEmitter {
  constructor() {
    super();
    this.visible = true;
    this.interactive = false;
    this.alpha = 1;
    this.x = 0;
    this.y = 0;
    this.scale = new Point(1, 1);
    this.anchor = new Point(0, 0);
    this.pivot = new Point(0, 0);
    this.rotation = 0;
    this.position = new Point(0, 0);
    this.mask = null;
    this.filters = null;
    this.parent = null;
    this.texture = null;
    this.tint = 0xFFFFFF;
    this.blendMode = 0;
    this.buttonMode = false;
  }
  destroy() {}
  getBounds() { return new Rectangle(0, 0, 0, 0); }
  getLocalBounds() { return new Rectangle(0, 0, 0, 0); }
  toGlobal(pos) { return new Point(pos.x, pos.y); }
  toLocal(pos) { return new Point(pos.x, pos.y); }
}

class Container extends DisplayObject {
  constructor() {
    super();
    this.children = [];
  }
  addChild(child) {
    if (child) {
      child.parent = this;
      this.children.push(child);
    }
    return child;
  }
  addChildAt(child, index) {
    if (child) {
      child.parent = this;
      this.children.splice(index, 0, child);
    }
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
    return child;
  }
  removeChildAt(index) {
    return this.removeChild(this.children[index]);
  }
  removeChildren(begin, end) {
    const removed = this.children.splice(begin || 0, end || this.children.length);
    removed.forEach(c => { if (c) c.parent = null; });
    return removed;
  }
  getChildAt(index) { return this.children[index]; }
  getChildIndex(child) { return this.children.indexOf(child); }
  setChildIndex(child, index) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      this.children.splice(index, 0, child);
    }
  }
  swapChildren(a, b) {
    const ia = this.children.indexOf(a);
    const ib = this.children.indexOf(b);
    if (ia >= 0 && ib >= 0) {
      this.children[ia] = b;
      this.children[ib] = a;
    }
  }
}

class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = (y !== undefined) ? y : x; }
  clone() { return new Point(this.x, this.y); }
  copy(p) { this.x = p.x; this.y = p.y; }
  equals(p) { return this.x === p.x && this.y === p.y; }
}

class Rectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x; this.y = y; this.width = width; this.height = height;
  }
  clone() { return new Rectangle(this.x, this.y, this.width, this.height); }
  contains(x, y) {
    return x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height;
  }
}

class Circle {
  constructor(x = 0, y = 0, radius = 0) {
    this.x = x; this.y = y; this.radius = radius;
  }
  clone() { return new Circle(this.x, this.y, this.radius); }
  contains(x, y) {
    const dx = x - this.x, dy = y - this.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }
}

class Polygon {
  constructor(points) { this.points = points || []; this.closed = true; }
  clone() { return new Polygon(this.points.slice()); }
  contains() { return false; }
}

// ── Texture & Sprite ──────────────────────────────────────────────

class BaseTexture extends EventEmitter {
  constructor() {
    super();
    this.width = 1; this.height = 1;
    this.hasLoaded = true;
    this.isLoading = false;
  }
  destroy() {}
}

class Texture extends EventEmitter {
  constructor(baseTexture) {
    super();
    this.baseTexture = baseTexture || new BaseTexture();
    this.frame = new Rectangle(0, 0, 1, 1);
    this.orig = new Rectangle(0, 0, 1, 1);
    this.trim = null;
    this.width = 1;
    this.height = 1;
    this.noFrame = false;
    this.valid = true;
  }
  destroy() {}
  clone() { return new Texture(this.baseTexture); }

  static from() { return new Texture(); }
  static fromImage() { return new Texture(); }
  static fromFrame(frameId) {
    const cached = TextureCache[frameId];
    return cached || new Texture();
  }
  static fromCanvas() { return new Texture(); }
}
Texture.EMPTY = new Texture();

class RenderTexture extends Texture {
  static create(width, height) { return new RenderTexture(); }
}

class Sprite extends Container {
  constructor(texture) {
    super();
    this.texture = texture || Texture.EMPTY;
    this.anchor = new Point(0, 0);
    this.tint = 0xFFFFFF;
    this.blendMode = 0;
    this.width = 0;
    this.height = 0;
  }
  static from() { return new Sprite(); }
  static fromFrame() { return new Sprite(); }
  static fromImage() { return new Sprite(); }
}

class Text extends Sprite {
  constructor(text, style) {
    super();
    this.text = text || '';
    this.style = style || {};
  }
}

class Graphics extends Container {
  constructor() {
    super();
    this.lineStyle = function () { return this; };
    this.beginFill = function () { return this; };
    this.endFill = function () { return this; };
    this.drawRect = function () { return this; };
    this.drawRoundedRect = function () { return this; };
    this.drawCircle = function () { return this; };
    this.drawEllipse = function () { return this; };
    this.drawPolygon = function () { return this; };
    this.moveTo = function () { return this; };
    this.lineTo = function () { return this; };
    this.quadraticCurveTo = function () { return this; };
    this.bezierCurveTo = function () { return this; };
    this.arc = function () { return this; };
    this.arcTo = function () { return this; };
    this.clear = function () { return this; };
    this.closePath = function () { return this; };
  }
}

// ── Filter ────────────────────────────────────────────────────────

class Filter {
  constructor(vertexSrc, fragmentSrc) {
    this.vertexSrc = vertexSrc || '';
    this.fragmentSrc = fragmentSrc || '';
    this.uniforms = {};
    this.enabled = true;
  }
  apply() {}
}
Filter.defaultVertexSrc = '';

class ColorMatrixFilter extends Filter {
  constructor() {
    super();
    this.matrix = new Float32Array(20);
  }
  brightness() {}
  greyscale() {}
  grayscale() {}
  saturate() {}
  desaturate() {}
  hue() {}
  contrast() {}
  negative() {}
  sepia() {}
}

// ── Loader ────────────────────────────────────────────────────────

class Loader extends EventEmitter {
  constructor(basePath) {
    super();
    this.basePath = basePath || '';
    this.resources = {};
    this.loading = false;
    this.progress = 0;
    this.onProgress = { add: () => {} };
    this.onError = { add: () => {} };
    this.onLoad = { add: () => {} };
    this.onComplete = { add: () => {} };
  }
  add(name, url, options, cb) { return this; }
  load(cb) {
    if (cb) setTimeout(() => cb(this, this.resources), 0);
    return this;
  }
  reset() { this.resources = {}; return this; }
  destroy() {}
}

// ── Extras ────────────────────────────────────────────────────────

class AnimatedSprite extends Sprite {
  constructor(textures) {
    super();
    this.textures = textures || [];
    this.animationSpeed = 1;
    this.loop = true;
    this.playing = false;
    this.currentFrame = 0;
  }
  play() { this.playing = true; }
  stop() { this.playing = false; }
  gotoAndPlay(frame) { this.currentFrame = frame; this.playing = true; }
  gotoAndStop(frame) { this.currentFrame = frame; this.playing = false; }
}

class TilingSprite extends Sprite {
  constructor(texture, width, height) {
    super(texture);
    this.tilePosition = new Point(0, 0);
    this.tileScale = new Point(1, 1);
    this.width = width || 0;
    this.height = height || 0;
  }
}

class Rope extends Container {
  constructor(texture, points) {
    super();
    this.texture = texture;
    this.points = points || [];
  }
}

// ── Application ───────────────────────────────────────────────────

class Application {
  constructor(options) {
    this.stage = new Container();
    this.renderer = {
      width: (options && options.width) || 800,
      height: (options && options.height) || 600,
      view: {},
      resize() {},
      destroy() {},
      render() {},
      plugins: { interaction: { on() {}, mouse: { global: new Point() } } },
    };
    this.view = this.renderer.view;
    this.ticker = { add() {}, remove() {}, start() {}, stop() {} };
  }
  destroy() {}
  render() {}
}

// ── Texture cache ─────────────────────────────────────────────────

const TextureCache = {};

// ── GroupD8 ───────────────────────────────────────────────────────

const GroupD8 = {
  isVertical(rotation) { return rotation % 2 !== 0; },
};

// ── SCALE_MODES ───────────────────────────────────────────────────

const SCALE_MODES = { LINEAR: 1, NEAREST: 0 };

// ── settings ──────────────────────────────────────────────────────

const settings = {
  GC_MAX_CHECK_COUNT: 600,
  GC_MAX_IDLE: 3600,
  RESOLUTION: 1,
  SCALE_MODE: SCALE_MODES.LINEAR,
};

// ── Assemble PIXI namespace ──────────────────────────────────────

const PIXI = {
  Application,
  Container,
  Sprite,
  Text,
  Graphics,
  Texture,
  RenderTexture,
  BaseTexture,
  Point,
  Rectangle,
  Circle,
  Polygon,
  Filter,
  GroupD8,
  SCALE_MODES,
  DisplayObject,
  settings,

  loaders: { Loader },
  extras: { AnimatedSprite, TilingSprite },
  filters: { ColorMatrixFilter },
  mesh: { Rope },
  utils: {
    TextureCache,
    EventEmitter,
    isWebGLSupported() { return false; },
  },
};

module.exports = PIXI;
