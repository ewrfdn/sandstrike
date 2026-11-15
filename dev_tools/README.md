# SANDSTRIKE // DEV TOOLS

开发期工具集，与游戏源码 `src/` **平级**、彼此独立。游戏（`index.html` + `src/`）不 import 这里的任何文件，也不会把 React / 查看器代码打进发行包；本目录只服务开发与 QA。

```
dev_tools/
  README.md          ← 本文件
  ui/                ← Vite + React 查看器（模型查看 / 地图查看）
    index.html
    vite.config.mjs
    src/
      main.jsx       ← React 入口
      App.jsx        ← 应用外壳：顶部标签 + 两个 viewer
      app.css        ← 共享设计 token / 布局
      components/
        ModelViewer.jsx / .css   ← 模型查看面板（搜索 / 分组 / 列表 / 视角 / 姿态）
        MapViewer.jsx   / .css   ← 地图查看面板（地图切换 / 自由摄像机 / HUD）
      stage/
        model-stage.js           ← 隔离模型舞台（framework-free）
        map-stage.js             ← 真实地图 + 自由摄像机（framework-free）
  server/            ← 预留：未来通过它提供「编辑」能力（当前为空，只有 README）
```

## 运行

```bash
npm install            # 首次：安装 vite / react（已在 devDependencies）
npm run dev:tools      # Vite 开发服务器 → http://127.0.0.1:5199/
```

- 模型查看：`http://127.0.0.1:5199/`（或 `?tab=models&m=<modelId>` 直达某个模型）
- 地图查看：`http://127.0.0.1:5199/?tab=map&map=<mapId>`
- 渲染质量：URL 加 `?quality=medium|high|ultra`（默认 high）
- `npm run build:tools`：静态构建到 `dev_tools/ui/dist/`（gitignored），`npm run preview:tools` 预览。
- `npm run qa:devtools`：Playwright 冒烟测试（自动起 Vite、打开两个 viewer、校验模型/地图构建 + 摄像机可移动）。

### 模型查看 MODEL VIEWER

在隔离舞台上逐个预览 `src/models/` 里的所有模型（机器人 / 武器 / 世界道具）：

- 左侧：搜索、分组筛选、模型列表；支持 URL `?m=<id>` 直达。
- 画布：拖动旋转、滚轮缩放、双击复位；`1`–`5` 预置视角（3/4 / FRONT / SIDE / BACK / TOP）。
- `POSE` 行：机器人 BASE / AIM / WALK，武器与手持道具 BARE / HELD；`P` 键循环。
- 底部信息条：模型尺寸 / 三角面数 / 包围盒 / 当前轨道角度与缩放。
- 自动化：`?automation=1&tab=models` 全屏只有画布，并暴露 `window.__stage`（`scripts/model-shots.mjs` 使用）。

### 地图查看 MAP VIEWER

用游戏**真实的**地图数据（`src/config/maps/` + `src/world/`）构建整张地图，并用一台可自由移动的摄像机查看：

- 左侧：地图列表（outpost-07 / test-range / island-01 …）、摄像机速度、RESET CAMERA、操作提示。
- 摄像机：鼠标拖动看四周，`WASD` 前后左右，`Q/E` 下降/上升，`Shift` 加速，滚轮调速度，`R` 回到出生点。
- HUD：地图名 / 风格、坐标 / 朝向 / FPS / draw calls / 三角形 / 速度；地图构建时显示进度。
- 自动化：`?automation=1&tab=map&map=<id>` 全屏只有画布，并暴露 `window.__mapStage`。

## 架构约定

- **stage 与 UI 分离**：`stage/*.js` 是纯 Three.js 模块（可被 Node 之外的浏览器脚本 / 未来 server 端复用），React 组件只负责状态、面板与 HUD。游戏源码里的模型/世界构建函数直接 import，不复制一份。
- **复用 vendored Three.js**：`vite.config.mjs` 把 `three` / `three/addons/*` alias 到仓库的 `vendor/three/`，与游戏 `index.html` 的 importmap 指向同一份文件。
- **不在游戏里挂链接**：开发工具通过 `npm run dev:tools` 单独启动，游戏 `?dev` 模式不再生成查看器入口。
- **server 预留**：未来「在地图里编辑 / 保存」的能力放在 `dev_tools/server/`，UI 通过它的 HTTP API 读写地图数据；当前该目录只有设计说明，没有运行代码。

## 新增一个 viewer

1. 在 `dev_tools/ui/src/stage/` 加一个 framework-free 的 stage 模块（返回 API，负责 renderer/场景/循环/焦点输入）。
2. 在 `dev_tools/ui/src/components/` 加一个 React 组件（canvas + 面板 + HUD），并在 `App.jsx` 的顶栏加一个标签。
3. 需要自动化就用 `?automation=1` 分支只渲染 canvas，并挂一个 `window.__<name>` 句柄。
4. 在 `dev_tools/README.md` 和根 `README.md` 里补一条说明。

## 与发行包的关系

单文件发行包（`npm run build:html`）只打包 `index.html` + `src/main.js` + `styles.css`，产物在 `dist/sandstrike.html`；**不含**本目录。不要把游戏逻辑写进 dev tools，也不要在 `src/` 里 import `dev_tools/`。
