/**
 * SANDSTRIKE // DEV MAP VIEWER — React panel
 *
 * Hosts the real-world preview stage (api helpers in `stage/map-stage.js`):
 * one <canvas>, one WebGLRenderer for the lifetime of the component, a map list
 * sidebar, and a small inspection HUD (position / look / renderer counters).
 *
 * The stage itself is framework-free; this file only owns React lifecycle:
 *   - create the stage once on mount, dispose it on unmount
 *   - stop the RAF loop + input while the tab is inactive (`active` prop) but
 *     keep the built world so switching back is instant
 *   - never touch state after unmount (async world builds are token-guarded)
 *   - `automation` renders the bare canvas (deep-linking scripts/screenshots)
 *     and exposes the controller as `window.__mapStage`.
 *
 * Automation contract (`?automation=1`):
 *   window.__mapStage.state()               -> live stats snapshot
 *   window.__mapStage.loadMap('island-01')  -> Promise<summary>
 *   window.__mapStage.setActive(bool) / setSpeed(n) / resetCamera() / resize()
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_MAP_ID } from '../../../../src/world/data/index.js';
import { createMapStage } from '../stage/map-stage.js';
import './MapViewer.css';

/** Must match DEFAULT_SPEED in stage/map-stage.js. */
const SPEED_MIN = 0.5;
const SPEED_MAX = 80;
const SPEED_DEFAULT = 12;

const RAD_TO_DEG = 180 / Math.PI;

const messageOf = (error) => String((error && error.message) || error || 'unknown error');
const fmt = (value, digits = 2) => (Number.isFinite(value) ? Number(value).toFixed(digits) : '—');
const fmtInt = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—');

/** `sandstrike/map@1` -> `MAP@1` for the compact tag next to a map name. */
function formatBadge(format) {
  const match = /@(\d+)\s*$/.exec(String(format || ''));
  return match ? `MAP@${match[1]}` : 'MAP';
}

/** Resolve `?map=` against the registry, falling back to the default map. */
function pickInitialMap(maps, requested) {
  const list = Array.isArray(maps) ? maps : [];
  const ids = new Set(list.map((entry) => entry && entry.id).filter(Boolean));
  if (requested && ids.has(requested)) return requested;
  if (ids.has(DEFAULT_MAP_ID)) return DEFAULT_MAP_ID;
  return list[0] && list[0].id ? list[0].id : DEFAULT_MAP_ID;
}

/** Keep the map deep link in the URL without adding history entries. */
function syncUrl(mapId) {
  if (!mapId) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('map', mapId);
    window.history.replaceState(null, '', url);
  } catch (error) {
    /* file:// / sandboxed contexts may reject replaceState — the viewer still works */
  }
}

/** One status-bar cell: dim key + ink value(s). */
function Stat({ label, children, warn = false }) {
  return (
    <span className={`mapv-stat${warn ? ' is-warn' : ''}`}>
      <b>{label}</b>
      {children}
    </span>
  );
}

export default function MapViewer({ active = true, quality = 'high', automation = false }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const aliveRef = useRef(false);
  /** Token so a superseded / unmounted map build cannot write state anymore. */
  const loadTokenRef = useRef(0);
  /** True while the user drags the speed slider (the 5 Hz HUD must not fight it). */
  const speedDragRef = useRef(false);
  /** Quality is read at stage creation; kept in a ref so the mount effect stays [] */
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  const [maps, setMaps] = useState([]);
  const [activeMapId, setActiveMapId] = useState(null);
  const [stats, setStats] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [speed, setSpeed] = useState(SPEED_DEFAULT);

  // -------------------------------------------------------------------------
  // Map loading (also used by the initial load and the sidebar)
  // -------------------------------------------------------------------------
  const runLoad = useCallback(
    async (mapId, { keepCamera = false, replaceUrl = true } = {}) => {
      const stage = stageRef.current;
      if (!stage) return;
      const token = ++loadTokenRef.current;
      setError(null);
      setProgress({ value: 0, label: 'PREPARING MAP' });
      try {
        const summary = await stage.loadMap(mapId, { keepCamera });
        if (!aliveRef.current || token !== loadTokenRef.current) return;
        const snapshot = stage.state();
        setActiveMapId(summary.id);
        setProgress(null);
        setStats(snapshot);
        if (!speedDragRef.current) setSpeed(snapshot.speed);
        if (replaceUrl) syncUrl(summary.id);
      } catch (loadError) {
        if (!aliveRef.current || token !== loadTokenRef.current) return;
        setProgress(null);
        setError(messageOf(loadError));
      }
    },
    []
  );

  // -------------------------------------------------------------------------
  // Stage lifecycle — exactly one renderer per mounted <canvas>.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    aliveRef.current = true;

    const requestedMap = new URLSearchParams(window.location.search).get('map');
    let stage = null;
    try {
      stage = createMapStage({
        canvas,
        quality: qualityRef.current,
        onProgress: (value, label) => {
          if (!aliveRef.current) return;
          setProgress({ value, label });
        },
        onFrame: (snapshot) => {
          if (!aliveRef.current) return;
          setStats(snapshot);
          if (!speedDragRef.current) setSpeed(snapshot.speed);
        },
        onError: (stageError) => {
          if (!aliveRef.current) return;
          setError(messageOf(stageError));
        },
      });
    } catch (stageError) {
      console.error('[map-viewer] failed to create WebGL stage', stageError);
      setError(messageOf(stageError));
      aliveRef.current = false;
      return undefined;
    }

    stageRef.current = stage;
    // Automation harnesses read the live controller; harmless in the normal UI too.
    window.__mapStage = stage;

    setMaps(Array.isArray(stage.maps) ? stage.maps : []);
    stage.setActive(active);
    void runLoad(pickInitialMap(stage.maps, requestedMap), { replaceUrl: true });

    return () => {
      aliveRef.current = false;
      loadTokenRef.current += 1;
      stageRef.current = null;
      if (window.__mapStage === stage) {
        try {
          delete window.__mapStage;
        } catch (error) {
          /* ignore */
        }
      }
      stage.dispose();
    };
    // The canvas node and the URL are fixed for the lifetime of a mount;
    // `active` / `quality` are pushed through their own effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab visibility: stop rendering/input while the viewer pane is hidden.
  useEffect(() => {
    stageRef.current?.setActive(active);
  }, [active]);

  // Quality is a launch-time URL parameter; forward late changes for robustness.
  useEffect(() => {
    stageRef.current?.setQuality(quality);
  }, [quality]);

  // -------------------------------------------------------------------------
  // UI handlers
  // -------------------------------------------------------------------------
  const busy = progress !== null;

  const selectMap = useCallback(
    (mapId) => {
      // One world build at a time: the map list is disabled while loading too.
      if (!mapId || mapId === activeMapId || progress !== null) return;
      void runLoad(mapId, { replaceUrl: true });
    },
    [activeMapId, progress, runLoad]
  );

  const resetCamera = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.resetCamera();
    setStats(stage.state());
  }, []);

  const changeSpeed = useCallback((event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    setSpeed(value);
    stageRef.current?.setSpeed(value);
  }, []);

  // -------------------------------------------------------------------------
  // Automation mode: raw full-bleed canvas, no chrome at all.
  // -------------------------------------------------------------------------
  if (automation) {
    return <canvas ref={canvasRef} className="mapv-canvas mapv-canvas--auto" aria-label="Map viewport" />;
  }

  const snapshot = stats || {};
  const position = Array.isArray(snapshot.position) ? snapshot.position : [0, 0, 0];
  const yawDeg = Number.isFinite(snapshot.yaw) ? ((snapshot.yaw * RAD_TO_DEG) % 360 + 360) % 360 : null;
  const pitchDeg = Number.isFinite(snapshot.pitch) ? snapshot.pitch * RAD_TO_DEG : null;
  const fps = Number.isFinite(snapshot.fps) ? snapshot.fps : null;
  const loadPercent = progress ? Math.round(Math.max(0, Math.min(1, progress.value)) * 100) : 0;
  const currentMap = maps.find((entry) => entry.id === (snapshot.mapId || activeMapId)) || null;

  return (
    <div className="mapv">
      <aside className="mapv-side">
        <header className="mapv-side-head">
          <div className="mapv-side-title">MAP VIEWER</div>
          <div className="mapv-side-sub">地图查看 · REAL WORLD BUILD</div>
        </header>

        <section className="mapv-section">
          <div className="mapv-section-label">
            LEVELS <span>{maps.length}</span>
          </div>
          <div className="mapv-maps">
            {maps.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`mapv-map${entry.id === (snapshot.mapId || activeMapId) ? ' on' : ''}`}
                onClick={() => selectMap(entry.id)}
                disabled={busy || entry.id === (snapshot.mapId || activeMapId)}
                title={entry.description || entry.subtitle || entry.id}
              >
                <span className="mapv-map-badge">{formatBadge(entry.format)}</span>
                <span className="mapv-map-name">{entry.name || entry.id}</span>
                <span className="mapv-map-id">{entry.id}</span>
                {entry.subtitle ? <span className="mapv-map-sub">{entry.subtitle}</span> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="mapv-section">
          <div className="mapv-section-label">
            FLY SPEED <span className="mapv-speed-val">{fmt(speed, 1)} m/s</span>
          </div>
          <input
            className="mapv-slider"
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.5}
            value={speed}
            aria-label="Camera fly speed"
            onChange={changeSpeed}
            onPointerDown={() => {
              speedDragRef.current = true;
            }}
            onPointerUp={() => {
              speedDragRef.current = false;
            }}
            onPointerCancel={() => {
              speedDragRef.current = false;
            }}
            onBlur={() => {
              speedDragRef.current = false;
            }}
          />
          <div className="mapv-slider-scale">
            <span>{SPEED_MIN}</span>
            <span>{SPEED_MAX} m/s</span>
          </div>
          <button type="button" className="mapv-btn" onClick={resetCamera}>
            RESET CAMERA <kbd>R</kbd>
          </button>
        </section>

        <section className="mapv-section mapv-hints">
          <div className="mapv-section-label">CONTROLS</div>
          <ul>
            <li>
              <kbd>DRAG</kbd>
              <span>LOOK</span>
            </li>
            <li>
              <kbd>W A S D</kbd>
              <span>FLY</span>
            </li>
            <li>
              <kbd>Q / E</kbd>
              <span>DOWN / UP</span>
            </li>
            <li>
              <kbd>SHIFT</kbd>
              <span>BOOST ×4</span>
            </li>
            <li>
              <kbd>WHEEL</kbd>
              <span>SPEED</span>
            </li>
            <li>
              <kbd>R</kbd>
              <span>RESET</span>
            </li>
          </ul>
        </section>

        <div className="mapv-side-foot">QUALITY {String(quality).toUpperCase()}</div>
      </aside>

      <div className="mapv-stage">
        <canvas ref={canvasRef} className="mapv-canvas" aria-label="Map viewport" />

        <div className="mapv-hud-top">
          <div className="mapv-hud-name">{snapshot.mapName || currentMap?.name || '—'}</div>
          <div className="mapv-hud-meta">
            <span className="mapv-hud-style">{snapshot.style ? String(snapshot.style).toUpperCase() : '—'}</span>
            <span className="mapv-hud-id">{snapshot.mapId || activeMapId || '—'}</span>
          </div>
        </div>

        <div className="mapv-cross" aria-hidden="true" />

        {progress ? (
          <div className="mapv-progress" role="status" aria-live="polite">
            <div className="mapv-progress-card">
              <div className="mapv-progress-label">{progress.label || 'BUILDING WORLD'}</div>
              <div className="mapv-progress-bar">
                <div className="mapv-progress-fill" style={{ width: `${loadPercent}%` }} />
              </div>
              <div className="mapv-progress-pct">{loadPercent}%</div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mapv-error" role="alert">
            <div className="mapv-error-head">MAP BUILD FAILED</div>
            <div className="mapv-error-msg">{error}</div>
            <button type="button" className="mapv-error-close" onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        ) : null}

        <div className="mapv-status">
          <Stat label="POS">
            <span>X {fmt(position[0])}</span>
            <span>Y {fmt(position[1])}</span>
            <span>Z {fmt(position[2])}</span>
          </Stat>
          <Stat label="YAW">
            <span>{yawDeg === null ? '—' : `${fmt(yawDeg, 1)}°`}</span>
          </Stat>
          <Stat label="PITCH">
            <span>{pitchDeg === null ? '—' : `${fmt(pitchDeg, 1)}°`}</span>
          </Stat>
          <Stat label="FPS" warn={fps !== null && fps < 30}>
            <span>{fps === null ? '—' : fps}</span>
          </Stat>
          <Stat label="DRAW CALLS">
            <span>{fmtInt(snapshot.calls)}</span>
          </Stat>
          <Stat label="TRIS">
            <span>{fmtInt(snapshot.triangles)}</span>
          </Stat>
          <Stat label="SPEED">
            <span>{fmt(speed, 1)} m/s</span>
          </Stat>
          {snapshot.textures !== undefined ? (
            <Stat label="TEX">
              <span>{fmtInt(snapshot.textures)}</span>
            </Stat>
          ) : null}
        </div>
      </div>
    </div>
  );
}
