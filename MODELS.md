# MODELS // 模型目录

SANDSTRIKE 的所有可预览模型都按 **一个模型一个文件** 放在 `src/models/` 下，
由共享几何工具、模型注册表和两个 dev-only 预览入口组成。

```
src/models/
  core.js                共享工具：几何 UV/合并、matrix 辅助、batch、招牌/门窗/拱门、
                         instancing、布面材质注册、decal 合并、TAU/DEG
  index.js               MODEL_CATALOG：world + robot + weapon 的统一目录（视图/HUD 用）
  world/
    index.js             WORLD_MODELS 桶文件（metadata + build）
    crate.js … sacks.js  7 个 instanced 杂物族
    well.js truck.js …   18 个场景道具 / 建筑 / 布面 / 灯具
    rpg-launcher.js      RPG-7 火箭筒（设计稿，不进入关卡）
    boundary.js          map 边界墙（非预览）
    mid-wall.js          中门墙（mid-gate 预览复用）
  robots/
    shared.js            RigBuilder、材质/调色、通用骨架部件
    scout.js rifleman.js heavy.js warlord.js boss.js   每个底盘一个文件
    preview.js           createRobotPreview（舞台预览姿态）
    index.js             ROBOT_TYPES / TYPE_KEYS / buildRobotRig / 预览入口
  weapons/
    vxr7.js              VXR-7 第一人称武器模型（weapons.js 只保留射击/动画逻辑）
```

## 模型文件约定（world）

每个 `src/models/world/<id>.js` 导出：

```js
export const meta = { id, kind: 'world', group, label };
export function build(ctx) { /* 预览：套用 stage 布局 + 预览脚手架，再调用 buildWorld */ }
export function buildWorld(ctx) { /* 地图装配：按 ctx.data.layout 生成全部实例 */ }
```

- 允许从 `../core.js`、`../../utils.js` 导入共享工具；不得从 `world.js` / `model-stage.js` 反向导入。
- 布面模型（banner/flag/awning）额外导出 `createBanner/createFlag/createAwning`，供
  `world.js` 的 `buildCloths`（共用 `makeRNG(1717)`）按固定顺序调用。
- 预览专用脚手架（临时支撑、背板等）只写在 `build()` 里并注明 `// preview-only scaffolding`。

## 预览方式（仅 dev 模式）

| 用途 | 入口 |
|---|---|
| **模型浏览器 WebUI（推荐）** | `http://127.0.0.1:8080/models.html?dev` |
| 单独舞台/自动化 | `http://127.0.0.1:8080/stage.html?m=<id>&view=front&pose=aim` |
| 游戏内 dev 入口 | `index.html?dev` 右下角 `模型预览 MODEL VIEWER` 按钮 |

- `models.html` 无 `?dev` 时显示 `DEV ONLY` 门禁，不加载渲染器。
- WebUI 左侧按组（杂物/主道具/建筑/布面/机器人/武器）列出全部模型，支持搜索、
  ↑/↓ 或 ←/→ 切换、1-5 切视角、P 切机器人姿态，也可 `?m=<id>` 直达。
- **自由旋转**：在预览画面中拖动可 360° 环绕查看模型（上下拖动改俯仰角），
  滚轮/触控缩放；双击画面或点 `RESET` 回到预置视角。信息栏实时显示
  `AZ / EL / ZOOM`，自由旋转时显示 `CUSTOM ORBIT`。
- 修复/迭代时建议先用 WebUI 目测（可任意角度查看），再用自动化批量出图。

## 自动化 QA

```bash
# 全模型 40 张 4 视图 contact sheet → shots/models/<id>.jpg + index.json
node scripts/model-shots.mjs --quality=high

# 单个模型 / 指定视角
node scripts/model-shots.mjs --only=well,truck
node scripts/model-shots.mjs --single=robot-boss,side,walk,1.2,.scratch/boss-side.jpg
```

回归要求：修改模型后 `node scripts/check.mjs`、`node scripts/qa.mjs`（errors=[]）、
`node scripts/map-audit.mjs`（空气墙/悬浮/不可达 0）必须保持通过；渲染结果应与
修改前 baseline 像素一致（除有意改动）。
