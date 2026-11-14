/**
 * SANDSTRIKE // map data schema helpers.
 *
 * This module is deliberately free of `three` and DOM imports so the map data layer
 * can run inside the game bundle *and* in plain Node (`check-parity.mjs`, docs tools).
 *
 * Colour convention (see `src/config/maps/README.md`):
 *  - `"#rrggbb"` / `"#rgb"` -> numeric `0xrrggbb` for `THREE.Color` style params
 *  - `[r, g, b]`            -> linear values for `Color.setRGB(...)` style params
 * The data layer never converts to a THREE object; `colorValue()` only normalises the
 * JSON representation. Consumers decide how to hand it to three.js.
 */

/** Format id written into `map.json` and dispatched on by `loadMap()`. */
export const MAP_FORMAT = 'sandstrike/map@1';

/** Tropical island format (see `formats/v2.js`). */
export const MAP_FORMAT_ISLAND = 'sandstrike/map@2';

/** Every level format this build knows how to load (adapters live in `formats/`). */
export const MAP_FORMATS = Object.freeze([MAP_FORMAT, MAP_FORMAT_ISLAND]);

// ---------------------------------------------------------------------- types

export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Deep clone of plain JSON data (map data must always be structured-cloneable). */
export function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

// --------------------------------------------------------------------- colours

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * `"#rrggbb"` (or `"#rgb"`, with or without the `#`) -> `0xrrggbb` number.
 * Numbers pass through (allows `0xffa050` in hand-written code).
 * @throws {Error} when the value is not a hex colour
 */
export function hexColor(value) {
  if (isFiniteNumber(value)) return value >>> 0;
  if (typeof value === 'string') {
    const match = HEX_COLOR_RE.exec(value.trim());
    if (!match) throw new Error(`invalid hex colour: ${JSON.stringify(value)}`);
    let hex = match[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return Number.parseInt(hex, 16);
  }
  throw new Error(`invalid hex colour: ${JSON.stringify(value)}`);
}

/**
 * Normalise a map colour value without touching three.js:
 *  - `"#rrggbb"` string -> `0xrrggbb` number
 *  - `[r, g, b]` linear triple -> fresh `[r, g, b]` array (pass-through)
 *  - finite number -> number
 */
export function colorValue(value) {
  if (Array.isArray(value)) {
    if (value.length !== 3 || !value.every(isFiniteNumber)) {
      throw new Error(`invalid linear colour: ${JSON.stringify(value)}`);
    }
    return value.slice();
  }
  return hexColor(value);
}


// ------------------------------------------------------------------ numbers / tuples

/**
 * Read a finite number from `source[key]`, falling back to `fallback` when absent or
 * invalid. Map defaults must match the historical hard-coded values exactly.
 */
export function readNumber(source, key, fallback = 0) {
  const value = isPlainObject(source) ? source[key] : undefined;
  return isFiniteNumber(value) ? value : fallback;
}

/** Read a string field with a fallback when absent / not a string. */
export function readString(source, key, fallback = '') {
  const value = isPlainObject(source) ? source[key] : undefined;
  return typeof value === 'string' ? value : fallback;
}

/**
 * Read a fixed-length numeric tuple (vector-ish JSON arrays). Returns a fresh array.
 * `fallback` may be an array or a scalar (broadcast).
 */
export function readTuple(source, key, length, fallback) {
  const value = isPlainObject(source) ? source[key] : undefined;
  if (Array.isArray(value) && value.length === length && value.every(isFiniteNumber)) {
    return value.slice();
  }
  if (Array.isArray(fallback)) return fallback.slice();
  return Array.from({ length }, () => fallback);
}

/** Read an array field, cloning it, or return `fallback` (fresh array). */
export function readArray(source, key, fallback = []) {
  const value = isPlainObject(source) ? source[key] : undefined;
  return Array.isArray(value) ? value.slice() : fallback.slice();
}

// ------------------------------------------------------------ defaults merging

/**
 * Deep-fill `raw` with `defaults` for missing keys. Extra keys authored in `raw` are
 * preserved (future-facing map fields can be added before the code reads them).
 * Arrays are treated as leaves: a present array wins wholesale.
 */
export function withDefaults(raw, defaults) {
  if (Array.isArray(defaults)) {
    return Array.isArray(raw) ? deepClone(raw) : deepClone(defaults);
  }
  if (isPlainObject(defaults)) {
    const out = {};
    const src = isPlainObject(raw) ? raw : {};
    for (const key of Object.keys(defaults)) {
      out[key] = withDefaults(src[key], defaults[key]);
    }
    for (const key of Object.keys(src)) {
      if (!(key in out)) out[key] = deepClone(src[key]);
    }
    return out;
  }
  if (raw === undefined) return deepClone(defaults);
  return raw;
}

// ------------------------------------------------------------------- validation

/** Push an error unless `condition` holds. Returns the condition for chaining. */
export function check(errors, condition, message) {
  if (!condition) errors.push(message);
  return !!condition;
}

/** Require an object field; returns it (or `{}` after recording an error). */
export function requireObject(errors, value, path) {
  if (isPlainObject(value)) return value;
  errors.push(`${path}: expected an object`);
  return {};
}

/** Require an array field; returns it (or `[]` after recording an error). */
export function requireArray(errors, value, path) {
  if (Array.isArray(value)) return value;
  errors.push(`${path}: expected an array`);
  return [];
}

/** Require numeric fields on an object (optionally a subset of the allowed extras). */
export function requireNumbers(errors, object, path, fields) {
  for (const field of fields) {
    const value = isPlainObject(object) ? object[field] : undefined;
    if (!isFiniteNumber(value)) errors.push(`${path}.${field}: expected a finite number`);
  }
}

/** Require string fields on an object (empty strings allowed unless listed). */
export function requireStrings(errors, object, path, fields, { allowEmpty = true } = {}) {
  for (const field of fields) {
    const value = isPlainObject(object) ? object[field] : undefined;
    if (typeof value !== 'string') errors.push(`${path}.${field}: expected a string`);
    else if (!allowEmpty && value.length === 0) errors.push(`${path}.${field}: must not be empty`);
  }
}

/** Validate a colour value is either a hex string or a linear `[r,g,b]` tuple. */
export function requireColor(errors, value, path) {
  if (isFiniteNumber(value)) return;
  if (typeof value === 'string' && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) return;
  if (Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)) return;
  errors.push(`${path}: expected "#rrggbb", 0xrrggbb or [r,g,b]`);
}

/**
 * Walk `value` looking for anything that is not plain structured-cloneable JSON data
 * (functions, symbols, class instances, THREE objects, DOM nodes). Returns a list of
 * human readable paths. Used to guarantee `loadMap()` output is pure data.
 */
export function findImpureData(value, path = 'data', out = [], seen = new Set()) {
  if (value === null) return out;
  const type = typeof value;
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    out.push(`${path}: ${type} is not map data`);
    return out;
  }
  if (type !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) findImpureData(value[i], `${path}[${i}]`, out, seen);
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    out.push(`${path}: non-plain object (${value.constructor?.name ?? 'unknown'})`);
    return out;
  }
  for (const key of Object.keys(value)) findImpureData(value[key], `${path}.${key}`, out, seen);
  return out;
}
