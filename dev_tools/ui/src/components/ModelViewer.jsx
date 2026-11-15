/**
 * SANDSTRIKE // DEV TOOLS — MODEL VIEWER panel.
 *
 * React front-end for the isolated model stage. All Three.js work lives in
 * `../stage/model-stage.js`; this component owns the catalog sidebar (search /
 * group filter / list), the view + pose controls and the info bar, and keeps the
 * stage in sync. Drag / wheel on the canvas orbit the camera; arrow keys cycle
 * models; 1-5 pick a preset view; P cycles poses.
 *
 * The stage is created once per mount and disposed on unmount. `active=false`
 * only hides the tab (the stage keeps its built textures so switching back is
 * instant); model work is on-demand (one render per action), not a render loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createModelStage } from '../stage/model-stage.js';
import './ModelViewer.css';

const QUALITY_LABELS = { medium: 'MEDIUM', high: 'HIGH', ultra: 'ULTRA' };

const GROUP_META = {
  clutter: '杂物 CLUTTER',
  hero: '主道具 HERO',
  flora: '植被 FLORA',
  village: '草村 VILLAGE',
  ruin: '遗迹 RUINS',
  shore: '海岸 SHORE',
  loot: '掉落物 LOOT',
  architecture: '建筑 ARCHITECTURE',
  cloth: '布料 / 灯具 CLOTH & LIGHT',
  robots: '机器人 ROBOTS',
  weapon: '武器 WEAPON',
};
const GROUP_ORDER = Object.keys(GROUP_META);

const VIEW_LABELS = {
  'three-quarter': '3/4',
  front: 'FRONT',
  side: 'SIDE',
  back: 'BACK',
  top: 'TOP',
};

const POSE_LABELS = { base: 'BASE', aim: 'AIM', walk: 'WALK', bare: 'BARE', held: 'HELD' };
const poseLabel = (pose) => POSE_LABELS[pose] || String(pose).toUpperCase();

const groupLabel = (group) => GROUP_META[group] || String(group || '').toUpperCase();
const formatNumber = (value) => Number(value || 0).toLocaleString('en-US');

function readParams() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (_) {
    return new URLSearchParams();
  }
}

export default function ModelViewer({ active = true, quality = 'high', automation = false }) {
  const params = useMemo(readParams, []);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const showTokenRef = useRef(0);
  const viewRef = useRef('three-quarter');
  const poseRef = useRef(null);
  const activePosesRef = useRef([]);
  const loadingRef = useRef(false);
  const stateRef = useRef({});

  const [boot, setBoot] = useState({ phase: 'booting', progress: 0, label: '初始化模型舞台…', error: null });
  const [models, setModels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState('');
  const [filterGroup, setFilterGroup] = useState(null);
  const [view, setView] = useState('three-quarter');
  const [pose, setPose] = useState(null);
  const [stats, setStats] = useState(null);
  const [orbit, setOrbit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------
  const groups = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const model of models) {
      if (!seen.has(model.group)) {
        seen.add(model.group);
        list.push(model.group);
      }
    }
    list.sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
    });
    return list;
  }, [models]);

  const matchesFilter = useCallback((model) => {
    if (filterGroup && model.group !== filterGroup) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return model.id.toLowerCase().includes(q) || String(model.label || '').toLowerCase().includes(q);
  }, [filterGroup, query]);

  const visibleCount = useMemo(() => models.filter(matchesFilter).length, [models, matchesFilter]);

  // -------------------------------------------------------------------------
  // Stage lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    createModelStage({
      canvas,
      quality,
      onProgress: (progress, label) => {
        if (cancelled) return;
        setBoot((prev) => ({ ...prev, phase: 'booting', progress, label: label || prev.label }));
      },
      onCameraChange: (nextOrbit) => {
        if (!cancelled) setOrbit(nextOrbit);
      },
    })
      .then((stage) => {
        if (cancelled) {
          stage.dispose();
          return;
        }
        stageRef.current = stage;
        setModels(stage.models);
        setBoot({ phase: 'ready', progress: 1, label: '' });
        // Deep links: ?m=<id>&view=<preset>&pose=<pose>, otherwise the first
        // catalog entry in the three-quarter view.
        const wanted = params.get('m');
        const initial = wanted && stage.models.some((model) => model.id === wanted) ? wanted : stage.models[0]?.id;
        const wantedView = params.get('view');
        const deepView = wantedView && stage.views.includes(wantedView) ? wantedView : 'three-quarter';
        viewRef.current = deepView;
        setView(deepView);
        if (initial) {
          void selectModelRef.current(initial, {
            replaceUrl: !wanted,
            view: deepView,
            pose: params.get('pose') || undefined,
          });
        }
      })
      .catch((bootError) => {
        if (cancelled) return;
        setBoot({ phase: 'error', progress: 0, label: '', error: String(bootError?.message || bootError) });
      });

    return () => {
      cancelled = true;
      const stage = stageRef.current;
      stageRef.current = null;
      if (stage) stage.dispose();
    };
    // The stage is created once; quality changes require a page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint after a hidden tab becomes visible again: the panel may have been
  // resized by the browser while visibility was hidden.
  useEffect(() => {
    if (!active) return undefined;
    const id = window.requestAnimationFrame(() => stageRef.current?.resize());
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  // -------------------------------------------------------------------------
  // Actions (stable via refs so keyboard listeners never go stale)
  // -------------------------------------------------------------------------
  const syncOrbit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      setOrbit(stage.orbitState());
    } catch (_) {
      /* stage mid-dispose */
    }
  }, []);

  const chooseView = useCallback((name) => {
    const stage = stageRef.current;
    if (!stage) return;
    viewRef.current = name;
    setView(name);
    if (!stage.current()) return;
    stage.setView(name);
    stage.render();
    syncOrbit();
  }, [syncOrbit]);

  const choosePose = useCallback((nextPose) => {
    const stage = stageRef.current;
    if (!stage || !stage.current() || loadingRef.current) return;
    if (!activePosesRef.current.includes(nextPose)) return;
    poseRef.current = nextPose;
    setPose(nextPose);
    try {
      const nextStats = stage.setPose(nextPose);
      setStats(nextStats);
      if (nextStats?.pose) {
        poseRef.current = nextStats.pose;
        setPose(nextStats.pose);
      }
      syncOrbit();
    } catch (poseError) {
      setError(String(poseError?.message || poseError));
    }
  }, [syncOrbit]);

  const resetOrbit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !stage.current()) return;
    stage.resetOrbit();
    stage.render();
    syncOrbit();
  }, [syncOrbit]);

  const selectModel = useCallback(async (id, { replaceUrl = true, view: requestedView, pose: requestedPose } = {}) => {
    const stage = stageRef.current;
    if (!stage) return;
    const model = stage.models.find((entry) => entry.id === id);
    if (!model) return;
    const token = ++showTokenRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setActiveId(id);

    // The deep link may ask for a preset view; invalid names fall back to the
    // current view (which is the three-quarter default on boot).
    const viewName = requestedView && stage.views.includes(requestedView) ? requestedView : viewRef.current;
    if (viewName !== viewRef.current) {
      viewRef.current = viewName;
      setView(viewName);
    }

    const poses = Array.isArray(model.poses) ? model.poses.slice() : [];
    activePosesRef.current = poses;
    const fallbackPose = model.defaultPose && poses.includes(model.defaultPose) ? model.defaultPose : poses[0];
    const initialPose = requestedPose && poses.includes(requestedPose) ? requestedPose : poses.length ? fallbackPose : null;
    poseRef.current = initialPose;
    setPose(initialPose);
    setStats(null);

    if (replaceUrl && !automation) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'models');
      url.searchParams.set('m', id);
      try {
        window.history.replaceState(null, '', url);
      } catch (_) {
        /* history may be unavailable under file:// — the viewer still works */
      }
    }
    if (!automation) document.title = `MODEL VIEWER // ${id}`;

    try {
      const nextStats = await stage.show(id, { pose: initialPose || undefined, view: viewRef.current });
      if (token !== showTokenRef.current) return;
      setStats(nextStats);
      if (nextStats?.pose) {
        poseRef.current = nextStats.pose;
        setPose(nextStats.pose);
      }
      syncOrbit();
    } catch (showError) {
      if (token !== showTokenRef.current) return;
      setError(String(showError?.message || showError));
    } finally {
      if (token === showTokenRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [automation, syncOrbit]);

  const selectModelRef = useRef(selectModel);
  selectModelRef.current = selectModel;

  // Cycle the visible models (arrow keys / list order).
  const cycleModel = useCallback((delta) => {
    const stage = stageRef.current;
    if (!stage) return;
    const visible = stage.models.filter(matchesFilter);
    if (!visible.length) return;
    const index = visible.findIndex((model) => model.id === activeId);
    const next = visible[(index + delta + visible.length) % visible.length];
    void selectModelRef.current(next.id);
  }, [matchesFilter, activeId]);

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------
  stateRef.current = { activeId, query, filterGroup, activePoses: activePosesRef.current };
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) {
        if (event.key === 'Escape') event.target.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycleModel(1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        cycleModel(-1);
      } else if (event.key === 'p' || event.key === 'P') {
        const poses = activePosesRef.current;
        if (!poses.length) return;
        const index = Math.max(0, poses.indexOf(poseRef.current));
        choosePose(poses[(index + 1) % poses.length]);
      } else if (event.key >= '1' && event.key <= '5') {
        const stage = stageRef.current;
        const views = (stage && stage.views) || Object.keys(VIEW_LABELS);
        const nextView = views[Number(event.key) - 1];
        if (nextView) chooseView(nextView);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, cycleModel, choosePose, chooseView]);

  // -------------------------------------------------------------------------
  // Derived display strings
  // -------------------------------------------------------------------------
  const activeModel = models.find((model) => model.id === activeId) || null;
  const viewNames = (stageRef.current && stageRef.current.views) || Object.keys(VIEW_LABELS);
  const groupsWithModels = groups
    .map((group) => ({ group, items: models.filter((model) => model.group === group && matchesFilter(model)) }))
    .filter((entry) => entry.items.length > 0);

  const infoName = error ? 'BUILD FAILED' : loading ? 'LOADING…' : stats?.label || activeModel?.label || '—';
  const infoSmall = stats
    ? `${String(stats.id || '').toUpperCase()} · ${String(stats.group || '').toUpperCase()} · ${String(stats.kind || '').toUpperCase()}`
    : activeModel
      ? `${String(activeModel.id).toUpperCase()} · ${groupLabel(activeModel.group)}`
      : '';

  const metaLines = stats
    ? [
        `SIZE ${stats.size.map((v) => Number(v).toFixed(2)).join(' × ')} m    minY ${Number(stats.minY).toFixed(3)} m`,
        `TRIS ${formatNumber(stats.triangles)}    MESH ${stats.meshes}    VERTS ${formatNumber(stats.verts)}${stats.pose ? '    POSE ' + String(stats.pose).toUpperCase() : ''}`,
      ]
    : [];

  if (orbit) {
    const az = Math.round(Number(orbit.az));
    const el = Math.round(Number(orbit.el));
    const zoom = Number(orbit.distScale).toFixed(2);
    metaLines.push(`AZ ${az}°    EL ${el}°    ZOOM ${zoom}${orbit.custom ? '    CUSTOM ORBIT' : ''}`);
  }

  const activePreset = orbit && !orbit.custom ? orbit.name : null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (automation) {
    return (
      <div className="mv mv--automation">
        <canvas ref={canvasRef} className="mv-canvas" aria-label="model preview" />
      </div>
    );
  }

  return (
    <div className="mv">
      <aside className="mv-side" aria-label="model catalog">
        <div className="mv-search-wrap">
          <input
            className="mv-search"
            type="search"
            value={query}
            placeholder="搜索模型 / id…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="mv-chips">
          <button
            type="button"
            className={`mv-chip${filterGroup === null ? ' on' : ''}`}
            onClick={() => setFilterGroup(null)}
          >
            全部 ALL
          </button>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              className={`mv-chip${filterGroup === group ? ' on' : ''}`}
              onClick={() => setFilterGroup(group)}
            >
              {groupLabel(group)}
            </button>
          ))}
        </div>
        <div className="mv-count">
          {boot.phase === 'booting' ? 'LOADING STAGE…' : `${visibleCount} / ${models.length} MODELS`}
        </div>
        <nav className="mv-list" aria-label="model list">
          {groupsWithModels.map(({ group, items }) => (
            <div key={group}>
              <div className="mv-group-title">{groupLabel(group)}</div>
              {items.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={`mv-item${model.id === activeId ? ' on' : ''}`}
                  onClick={() => selectModel(model.id)}
                  title={`${model.id} — ${model.label || ''}`}
                >
                  <span className="mv-item-id">{model.id}</span>
                  <span className="mv-item-label">{model.label || ''}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="mv-main">
        <div className="mv-canvas-wrap">
          <canvas ref={canvasRef} className="mv-canvas" aria-label="model preview" />
          {boot.phase !== 'ready' ? (
            <div className={`mv-overlay${boot.phase === 'error' ? ' is-error' : ''}`}>
              {boot.phase === 'error' ? (
                <div className="mv-overlay-card">
                  <h2>STAGE BOOT FAILED</h2>
                  <p>{boot.error}</p>
                  <p className="mv-hint-text">检查 src/models 目录 / 刷新页面重试</p>
                </div>
              ) : (
                <div className="mv-overlay-card">
                  <div className="mv-boot-mark" />
                  <h2>MODEL STAGE</h2>
                  <p>{boot.label || 'GENERATING PROCEDURAL TEXTURES…'}</p>
                  <div className="mv-progress-track">
                    <div className="mv-progress-fill" style={{ width: `${Math.max(2, Math.round(boot.progress * 100))}%` }} />
                  </div>
                  <p className="mv-hint-text">{QUALITY_LABELS[quality] || 'HIGH'} · 一次性生成全部程序化贴图</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="mv-info">
          <div className="mv-info-name">
            {infoName}
            {infoSmall ? <small>{infoSmall}</small> : null}
          </div>
          <pre className="mv-info-meta">{error || metaLines.join('\n')}</pre>
          <div className="mv-controls">
            <div className="mv-control-group">
              <span>VIEW</span>
              {viewNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`mv-btn${activePreset === name ? ' on' : ''}`}
                  onClick={() => chooseView(name)}
                >
                  {VIEW_LABELS[name] || name.toUpperCase()}
                </button>
              ))}
              <button type="button" className="mv-btn" onClick={resetOrbit} title="回到当前预置视角（也可双击画布复位）">RESET</button>
            </div>
            <div className="mv-control-group">
              <span>POSE</span>
              {activePosesRef.current.length ? (
                activePosesRef.current.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`mv-btn${pose === name ? ' on' : ''}`}
                    disabled={loading}
                    onClick={() => choosePose(name)}
                  >
                    {poseLabel(name)}
                  </button>
                ))
              ) : (
                <button type="button" className="mv-btn" disabled title="该模型没有姿态">—</button>
              )}
            </div>
          </div>
          <div className="mv-hint">
            拖动画面旋转模型 · 滚轮缩放 · 双击复位 · ↑↓ 切换模型 · 1-5 预置视角 · P 切换姿态 · URL 加 ?m=&lt;id&gt; 直达
            {stats ? ` · PLATFORM R ${Number(stats.platformRadius || 0).toFixed(2)} m` : ''}
          </div>
        </div>
      </main>
    </div>
  );
}
