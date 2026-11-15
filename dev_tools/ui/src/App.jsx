/**
 * SANDSTRIKE // DEV TOOLS — application shell.
 *
 * A standalone Vite + React app that lives beside `src/` and imports the game's
 * real builders directly. It deliberately does NOT ship with the game: the
 * shipping bundle is still `src/main.js`, so React and all viewer code stay in
 * the dev-tools build only.
 *
 * Tabs:
 *   models — per-model preview studio (catalog from src/models/index.js)
 *   map    — the real map rendered through src/world/index.js with a free-fly camera
 *
 * URL parameters:
 *   ?tab=models|map   active tab
 *   ?quality=<q>      medium | high | ultra (default high)
 *   ?automation=1     full-bleed viewer, no dev chrome (used by scripts/*-probe)
 *   ?m=<modelId>      model viewer deep link
 *   ?map=<mapId>      map viewer deep link
 *   ?game=<url>       override the "GAME ↗" link (default http://127.0.0.1:8080/index.html?dev)
 */
import { useEffect, useMemo, useState } from 'react';
import ModelViewer from './components/ModelViewer.jsx';
import MapViewer from './components/MapViewer.jsx';

const QUALITIES = ['medium', 'high', 'ultra'];

const TABS = [
  { id: 'models', label: 'MODEL VIEWER', cn: '模型查看' },
  { id: 'map', label: 'MAP VIEWER', cn: '地图查看' },
];

const isTab = (value) => TABS.some((tab) => tab.id === value);

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const automation = params.get('automation') === '1';
  const quality = QUALITIES.includes(params.get('quality')) ? params.get('quality') : 'high';
  const initialTab = isTab(params.get('tab')) ? params.get('tab') : 'models';
  const gameUrl = params.get('game') || 'http://127.0.0.1:8080/index.html?dev';

  const [tab, setTab] = useState(initialTab);
  // The map world is expensive to build, so mount it lazily on first visit and
  // then keep it alive (hidden) so tab switches don't rebuild the whole map.
  const [mapMounted, setMapMounted] = useState(initialTab === 'map');

  useEffect(() => {
    if (automation) return undefined;
    document.title = `SANDSTRIKE // DEV TOOLS — ${tab === 'map' ? 'MAP' : 'MODEL'}`;
    return undefined;
  }, [tab, automation]);

  useEffect(() => {
    window.__devTools = {
      get tab() { return tab; },
      get quality() { return quality; },
      get automation() { return automation; },
      show(nextTab) { if (isTab(nextTab)) activate(nextTab); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, quality, automation]);

  function activate(nextTab) {
    if (nextTab === 'map') setMapMounted(true);
    setTab(nextTab);
    if (automation) return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', nextTab);
    try {
      window.history.replaceState(null, '', url);
    } catch (_) {
      /* file:// / sandboxed contexts may reject replaceState — the tab still works */
    }
  }

  if (automation) {
    // Automation harnesses (scripts/model-shots.mjs, scripts/dev-tools-smoke.mjs)
    // get a raw full-viewport canvas; the viewers still expose window.__stage /
    // window.__mapStage so the existing probe API keeps working.
    return (
      <div className="automation-root">
        {tab === 'map'
          ? <MapViewer active quality={quality} automation />
          : <ModelViewer active quality={quality} automation />}
      </div>
    );
  }

  return (
    <div className="dev-app">
      <header className="dev-head">
        <div className="dev-brand" aria-label="SANDSTRIKE dev tools">
          <span className="dev-brand-main">SANDSTRIKE</span>
          <span className="dev-brand-split">//</span>
          <span className="dev-brand-sub">DEV TOOLS</span>
          <span className="dev-badge">DEV ONLY</span>
        </div>
        <nav className="dev-tabs" role="tablist" aria-label="dev tools views">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`dev-tab${tab === item.id ? ' on' : ''}`}
              onClick={() => activate(item.id)}
            >
              <span className="dev-tab-label">{item.label}</span>
              <span className="dev-tab-cn">{item.cn}</span>
            </button>
          ))}
        </nav>
        <div className="dev-head-right">
          <span className="dev-quality" title="dev tools render quality (?quality=medium|high|ultra)">QUALITY {quality.toUpperCase()}</span>
          <a className="dev-link" href={gameUrl} target="_blank" rel="noopener noreferrer">GAME ↗</a>
        </div>
      </header>
      <main className="dev-main">
        <section className="viewer-pane" data-active={tab === 'models' ? '1' : undefined} aria-hidden={tab !== 'models'}>
          <ModelViewer active={tab === 'models'} quality={quality} />
        </section>
        {mapMounted ? (
          <section className="viewer-pane" data-active={tab === 'map' ? '1' : undefined} aria-hidden={tab !== 'map'}>
            <MapViewer active={tab === 'map'} quality={quality} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
