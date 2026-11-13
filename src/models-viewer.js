/**
 * SANDSTRIKE // DEV MODEL VIEWER
 *
 * Browser UI for the per-model preview harness. Loaded only by models.html and
 * only when the URL carries ?dev — the gate is enforced in models.html itself.
 *
 * The viewer embeds stage.html in a same-origin iframe and drives it through the
 * window.__stage automation API (show / setView / setPose / render), so there is
 * exactly one renderer and one texture library, and switching models is instant.
 */

const params = new URLSearchParams(location.search);
const QUALITY = ['medium', 'high', 'ultra'].includes(params.get('quality')) ? params.get('quality') : 'high';

const GROUP_META = {
  clutter: '杂物 CLUTTER',
  hero: '主道具 HERO',
  architecture: '建筑 ARCHITECTURE',
  cloth: '布料 / 灯具 CLOTH & LIGHT',
  robots: '机器人 ROBOTS',
  weapon: '武器 WEAPON',
};
const VIEW_LABELS = {
  'three-quarter': '3/4',
  front: 'FRONT',
  side: 'SIDE',
  back: 'BACK',
  top: 'TOP',
};
const POSES = ['base', 'aim', 'walk'];

const el = {
  viewer: document.getElementById('viewer'),
  list: document.getElementById('list'),
  chips: document.getElementById('chips'),
  search: document.getElementById('search'),
  count: document.getElementById('count'),
  infoName: document.getElementById('info-name'),
  infoMeta: document.getElementById('info-meta'),
  viewButtons: document.getElementById('view-buttons'),
  poseButtons: document.getElementById('pose-buttons'),
  stageLink: document.getElementById('stage-link'),
  gameLink: document.getElementById('game-link'),
};

const state = {
  models: [],
  groups: [],
  activeId: null,
  filterGroup: null,
  query: '',
  view: 'three-quarter',
  pose: 'base',
  showToken: 0,
  lastStats: null,
  baseMeta: '',
  orbit: null,
};

// ---------------------------------------------------------------------------
// iframe boot
// ---------------------------------------------------------------------------
function stage() {
  return el.viewer.contentWindow && el.viewer.contentWindow.__stage ? el.viewer.contentWindow.__stage : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStage() {
  const deadline = performance.now() + 180000;
  while (performance.now() < deadline) {
    const api = stage();
    if (api && api.ready) return api;
    if (api && api.bootError) throw new Error(api.bootError);
    await sleep(200);
  }
  throw new Error('model stage boot timeout');
}

function ensureStageFrame() {
  const base = './stage.html?quality=' + encodeURIComponent(QUALITY);
  if (!el.viewer.src || el.viewer.src === 'about:blank' || !el.viewer.src.includes('stage.html')) {
    el.viewer.src = base;
  }
}

function hideStageChrome() {
  try {
    const doc = el.viewer.contentDocument;
    if (!doc || doc.getElementById('models-viewer-chrome')) return;
    const style = doc.createElement('style');
    style.id = 'models-viewer-chrome';
    style.textContent = '#stage-hud,#stage-hint{display:none !important}';
    doc.head.appendChild(style);
  } catch (_) {
    /* same-origin only; ignore */
  }
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function buildSidebar() {
  const groups = new Map();
  for (const model of state.models) {
    if (!groups.has(model.group)) groups.set(model.group, []);
    groups.get(model.group).push(model);
  }
  state.groups = Array.from(groups.keys());
  state.groups.sort((a, b) => Object.keys(GROUP_META).indexOf(a) - Object.keys(GROUP_META).indexOf(b));

  el.chips.textContent = '';
  const all = chip('全部 ALL', null);
  all.classList.add('on');
  el.chips.appendChild(all);
  for (const group of state.groups) {
    el.chips.appendChild(chip(GROUP_META[group] || group, group));
  }
  renderList();
}

function chip(label, group) {
  const button = document.createElement('button');
  button.className = 'chip';
  button.type = 'button';
  button.textContent = label;
  button.dataset.group = group === null ? '' : group;
  button.addEventListener('click', () => {
    state.filterGroup = group;
    el.chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === button));
    renderList();
  });
  return button;
}

function matchesFilter(model) {
  if (state.filterGroup && model.group !== state.filterGroup) return false;
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return model.id.toLowerCase().includes(q) || String(model.label || '').toLowerCase().includes(q);
}

function renderList() {
  el.list.textContent = '';
  let visible = 0;
  for (const group of state.groups) {
    const models = state.models.filter((model) => model.group === group && matchesFilter(model));
    if (!models.length) continue;
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = GROUP_META[group] || group;
    el.list.appendChild(title);
    for (const model of models) {
      visible++;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'item' + (model.id === state.activeId ? ' on' : '');
      item.dataset.id = model.id;
      const id = document.createElement('span');
      id.className = 'id';
      id.textContent = model.id;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = model.label || '';
      item.append(id, label);
      item.addEventListener('click', () => selectModel(model.id));
      el.list.appendChild(item);
    }
  }
  el.count.textContent = `${visible} / ${state.models.length} MODELS`;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function buildControls() {
  const api = stage();
  const views = (api && api.views) || Object.keys(VIEW_LABELS);
  el.viewButtons.textContent = '';
  for (const view of views) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-btn' + (view === state.view ? ' on' : '');
    button.textContent = VIEW_LABELS[view] || view.toUpperCase();
    button.dataset.view = view;
    button.addEventListener('click', () => setView(view));
    el.viewButtons.appendChild(button);
  }
  el.poseButtons.textContent = '';
  for (const pose of POSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pose-btn' + (pose === state.pose ? ' on' : '');
    button.textContent = pose.toUpperCase();
    button.dataset.pose = pose;
    button.disabled = true;
    button.addEventListener('click', () => setPose(pose));
    el.poseButtons.appendChild(button);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'view-btn';
  reset.id = 'view-reset';
  reset.textContent = 'RESET';
  reset.title = '回到当前预置视角（也可双击画布复位）';
  reset.addEventListener('click', () => {
    const api = stage();
    if (!api) return;
    if (api.resetOrbit) api.resetOrbit();
    else setView('three-quarter');
    api.render();
    if (api.orbitState) onCameraChange(api.orbitState());
  });
  el.viewButtons.appendChild(reset);
}

function refreshInfoMeta() {
  const parts = [];
  if (state.baseMeta) parts.push(state.baseMeta);
  const orbit = state.orbit;
  if (orbit) {
    const az = Number(orbit.az);
    const el = Number(orbit.el);
    const zoom = Number(orbit.distScale);
    parts.push(
      `AZ ${Math.round(az)}°    EL ${Math.round(el)}°    ZOOM ${zoom.toFixed(2)}${orbit.custom ? '    CUSTOM ORBIT' : ''}`
    );
  }
  if (parts.length) el.infoMeta.textContent = parts.join('\n');
}

/** Camera state pushed by the stage whenever the user drags / wheels / resets. */
function onCameraChange(orbit) {
  state.orbit = orbit || null;
  refreshInfoMeta();
  const activePreset = orbit && !orbit.custom ? orbit.name : null;
  el.viewButtons.querySelectorAll('.view-btn[data-view]').forEach((button) => {
    button.classList.toggle('on', button.dataset.view === activePreset);
  });
}

function setView(view) {
  state.view = view;
  el.viewButtons.querySelectorAll('.view-btn[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const api = stage();
  if (!api || !api.current || !api.current()) return;
  api.setView(view);
  api.render();
  if (api.orbitState) onCameraChange(api.orbitState());
}

function setPose(pose) {
  const api = stage();
  if (!api || !api.current || !api.current()) return;
  if (!state.activeIsRobot) return;
  state.pose = pose;
  el.poseButtons.querySelectorAll('.pose-btn').forEach((b) => b.classList.toggle('on', b.dataset.pose === pose));
  try {
    const stats = api.setPose(pose);
    updateInfo(stats);
    if (api.orbitState) onCameraChange(api.orbitState());
  } catch (error) {
    showError(error);
  }
}

function updateInfo(stats) {
  if (!stats) return;
  state.lastStats = stats;
  el.infoName.textContent = stats.label || stats.id;
  el.infoName.insertAdjacentHTML('beforeend', `<small>${String(stats.id || '').toUpperCase()} · ${String(stats.group || '').toUpperCase()} · ${String(stats.kind || '').toUpperCase()}</small>`);
  const size = Array.isArray(stats.size) ? stats.size : [0, 0, 0];
  const lines = [
    `SIZE ${size[0].toFixed(2)} × ${size[1].toFixed(2)} × ${size[2].toFixed(2)} m    minY ${Number(stats.minY).toFixed(3)} m`,
    `TRIS ${Number(stats.triangles).toLocaleString('en-US')}    MESH ${stats.meshes}    VERTS ${Number(stats.verts).toLocaleString('en-US')}${stats.pose ? '    POSE ' + String(stats.pose).toUpperCase() : ''}`,
  ];
  el.infoMeta.textContent = lines.join('\n');
  state.baseMeta = lines.join('\n');
  refreshInfoMeta();
  el.viewer.title = `${stats.id} — ${stats.label || ''}`;
}

function showError(error) {
  const message = String((error && error.message) || error);
  el.infoName.textContent = 'BUILD FAILED';
  el.infoMeta.textContent = message;
  el.infoName.insertAdjacentHTML('beforeend', '<small>检查模型文件 / core.js 拆分进度</small>');
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------
async function selectModel(id, { replaceUrl = true } = {}) {
  const model = state.models.find((m) => m.id === id);
  if (!model) return;
  const token = ++state.showToken;
  state.activeId = id;
  state.activeIsRobot = model.kind === 'robot';
  state.pose = model.kind === 'robot' ? model.defaultPose || 'base' : 'base';
  el.list.querySelectorAll('.item').forEach((item) => item.classList.toggle('on', item.dataset.id === id));
  el.poseButtons.querySelectorAll('.pose-btn').forEach((button) => {
    button.disabled = !state.activeIsRobot;
    button.classList.toggle('on', state.activeIsRobot && button.dataset.pose === state.pose);
  });
  el.infoName.textContent = 'LOADING…';
  el.infoMeta.textContent = model.id;
  if (replaceUrl) {
    const url = new URL(location.href);
    url.searchParams.set('dev', '1');
    url.searchParams.set('m', id);
    history.replaceState(null, '', url);
  }
  document.title = `MODEL VIEWER // ${id}`;
  try {
    const api = await waitForStage();
    if (token !== state.showToken) return;
    let stats;
    try {
      stats = await api.show(id, { pose: state.pose, view: state.view });
    } catch (error) {
      if (token !== state.showToken) return;
      showError(error);
      return;
    }
    if (token !== state.showToken) return;
    updateInfo(stats);
    if (api.orbitState) onCameraChange(api.orbitState());
    if (!state.activeIsRobot) {
      el.poseButtons.querySelectorAll('.pose-btn').forEach((button) => { button.disabled = true; });
    }
  } catch (error) {
    if (token === state.showToken) showError(error);
  }
}

function cycleModel(delta) {
  const visible = state.models.filter(matchesFilter);
  if (!visible.length) return;
  const index = visible.findIndex((m) => m.id === state.activeId);
  const next = visible[(index + delta + visible.length) % visible.length];
  selectModel(next.id);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function bindKeys() {
  window.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (event.key === 'Escape') event.target.blur();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); cycleModel(1); }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); cycleModel(-1); }
    else if (event.key === 'p' || event.key === 'P') {
      if (!state.activeIsRobot) return;
      const index = POSES.indexOf(state.pose);
      setPose(POSES[(index + 1) % POSES.length]);
    } else if (event.key >= '1' && event.key <= '5') {
      const api = stage();
      const views = (api && api.views) || Object.keys(VIEW_LABELS);
      const view = views[Number(event.key) - 1];
      if (view) setView(view);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  el.search.addEventListener('input', () => {
    state.query = el.search.value.trim();
    renderList();
  });
  el.stageLink.href = `./stage.html?quality=${QUALITY}`;
  if (el.gameLink) el.gameLink.href = './index.html?dev';
  bindKeys();
  ensureStageFrame();
  try {
    const api = await waitForStage();
    hideStageChrome();
    api.onCameraChange = onCameraChange;
    state.models = (api.models || []).slice();
    buildSidebar();
    buildControls();
    const wanted = params.get('m');
    const initial = wanted && state.models.some((m) => m.id === wanted) ? wanted : state.models[0] && state.models[0].id;
    if (initial) selectModel(initial, { replaceUrl: !wanted });
    window.__modelsViewer = { selectModel, state, getReload: () => location.href };
  } catch (error) {
    showError(error);
    el.count.textContent = 'STAGE FAILED';
  }
}

boot();
