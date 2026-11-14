# ISLAND MAP // 热带孤岛关卡设计 & 施工契约

> 目标：`island-01` = **ATOLL-09 / 碧潮环礁·第九区**。
> 四面环水的封闭热带小岛，清晨湿润雨林 + 茅草村落 + 零散遗迹，15 波敌人、每 5 波 Boss。
> 规模：**可玩陆地面积约为沙漠图 2 倍**（沙漠 66×66 = 4,356 m²；本图边界圆 r=52 → π·52² ≈ 8,494 m² = 1.95×），
> 总地图 140×140 m（含环礁水域），`mapBounds = ±70`。
>
> 本文是**施工契约**：数据格式、坐标分区、碰撞派生、验收命令、写作用域。改契约先改本文。

---

## 1. 世界坐标与总体分区

- 米制，+Y 上，地面 y=0，**北 = -Z，南 = +Z，东 = +X，西 = -X**。
- 岛是圆形：草地 r ≤ 41，沙滩环 r 38–62，海底坡 r 61–96（视觉），海水自分界 r≈62 起。
- **可玩边界**：环礁岩脊（collider）在 r ≈ 52，闭合一圈；只在**东南码头缺口**（角度 `atan2(24, 56) ≈ 0.405 rad`，宽 6 m）留可通过的通道，接木栈桥。
- 玩家在 r ≤ 52 内活动，y 恒为 0（平地）；木栈桥/村道高台通过“可踩碰撞盒”（顶面 ≤0.30 m）抬脚。
- 出生点：南滩营地 `(0, 46)`，yaw 0（面向 -Z，朝岛心）。

区域（名字用于 landmarks / 波次节奏）：

| 区域 | 中心 / 范围 | 内容 |
| --- | --- | --- |
| CAMP 南滩营地 | (0, 44) 附近 | 玩家出生、篝火、货箱、栈桥入口 |
| VILLAGE 草村 | (-2, 26) ± (18×14) | 3 茅屋 + 2 破屋 + 竹篱 + 晾晒架 + 村道 + 图腾 + 集市摊/木桶/货箱 |
| TEMPLE 古庙 | (-4, -28) ± (16×12) | 石拱门 + 断墙 + 石像 + 石柱群（北侧） |
| TOWER 崩石塔 | (10, -30) | 独立石塔 + 碎石 |
| EAST RUIN 东遗迹 | (24, -14) ± (10×8) | 残墙 + 石柱 |
| HEART 林心 | (0, 0) ± r8 | 林间空地、雨林核心（图腾/倒木） |
| JETTY 木码头 | (24, 56) | 栈桥伸入水面，缺口接沙滩 |
| WRECK 沉船滩 | (44, 8) | 沉船 + 浮木 + 岸礁 |
| WEST SHORE 西岸礁 | (-44, -4) | 岸礁群 + 椰林 |

---

## 2. 地图格式 `sandstrike/map@2`（新）

一张地图 = 文件夹 + **同样 6 个 part**（`world-check` 要求）：

```
src/config/maps/island-01/
  map.json          # 清单（format: sandstrike/map@2, bounds ±70, playerSpawn, parts）
  terrain.json      # 岛形/沙滩/海底/边界岩脊/水体参数
  environment.json  # 清晨天空/太阳/雾/半球光/氛围（pollen/mist）
  architecture.json # 村庄/遗迹/海岸结构摆放（只写摆放，碰撞自动派生）
  props.json        # 植被 + 复用道具摆放
  dressing.json     # 氛围装饰（v2 目前只读 ambience 覆盖）
  spawns.json       # 玩家/敌人出生候选、landmarks、解析参数
```

### 2.1 实例格式

所有摆放数组的元素统一：

```jsonc
{ "x": 0, "z": 0, "ry": 0, "s": 1 }      // x/z 必填；ry 弧度、s 缩放、y 可选（默认 0）
```

`layout.island.<key>` 的 key（= 模型 `buildWorld` 读取的数组）：

| 族 | 数组 key |
| --- | --- |
| 植被 | `jungleTrees` `coconutPalms` `vineDrapes` `bananaPlants` `fernClumps` `bambooClumps` `bushes` `fallenLogs` `grassTufts` |
| 村庄 | `huts` `hutRuins` `fences` `dryingRacks` `walkways` `totems` |
| 遗迹 | `ruinWalls` `ruinArches` `ruinTowers` `ruinIdols` `ruinColumns` |
| 海岸 | `shoreRocks` `jetties` `canoes` `driftwood` `wrecks` |

### 2.2 `architecture.json`

```jsonc
{
  "village": { "huts": [], "hutRuins": [], "fences": [], "dryingRacks": [], "walkways": [], "totems": [] },
  "ruins":   { "ruinWalls": [], "ruinArches": [], "ruinTowers": [], "ruinIdols": [], "ruinColumns": [] },
  "shore":   { "shoreRocks": [], "jetties": [], "canoes": [], "driftwood": [], "wrecks": [] },
  "extraSolids": [ { "x": 0, "z": 0, "w": 1, "d": 1, "h": 1, "surface": "stone", "y0": 0 } ]
}
```

### 2.3 `props.json`

```jsonc
{
  "flora": { "jungleTrees": [], "coconutPalms": [], "vineDrapes": [], "bananaPlants": [],
             "fernClumps": [], "bambooClumps": [], "bushes": [], "fallenLogs": [], "grassTufts": [] },
  "reuse": { "crates": [], "barrels": [], "lowWalls": [], "stalls": [], "campfires": [] }
}
```

复用的沙漠道具（自动接到既有 `buildWorld`）：

- `crates`: `{x,z,s,ry,stack}`（`stack` 叠几个，默认 1）
- `barrels`: `{x,z,yaw}`
- `lowWalls`: `{x,z,w,d,h,surface}`（矮墙/挡土墙，做村道边缘）
- `stalls`: `{x,z,ry}`（集市摊，村里用 1–2 个）
- `campfires`: `{x,z,ry}`（营地用 1 个；第一个会生成火光）

### 2.4 `terrain.json`（默认值见 `formats/v2.js`）

```jsonc
{
  "island": { "grassRadius": 41, "beachInner": 38, "beachOuter": 62, "landRadius": 62, "seed": 7712 },
  "sea": { "level": -0.38, "bedOuter": 96, "bedDrop": -7.5,
           "shallow": [0.10, 0.34, 0.32], "deep": [0.02, 0.09, 0.13] },
  "boundary": { "radius": 52.0, "segments": 116, "height": 1.65, "thickness": 3.2,
                "gap": { "angle": 0.405, "width": 6.0 } },
  "colors": { "grass": [0.42, 0.62, 0.36], "sand": [0.92, 0.84, 0.66], "seabed": [0.72, 0.68, 0.52] }
}
```

### 2.5 `spawns.json`

```jsonc
{
  "playerSpawn": { "x": 0, "y": 0, "z": 46, "yaw": 0 },
  "enemies": [ { "x": 0, "z": -40, "label": "NORTH JUNGLE" } ],
  "landmarks": [ { "x": -2, "z": 26, "name": "VILLAGE" } ],
  "resolve": { "clearance": 1.45, "playerMinDistance": 5, "minCount": 18,
               "playerClearance": 0.9, "validateClearance": 1.1 }
}
```

### 2.6 归一化后的 `ctx.data`

```
{ id, name, subtitle, description, format, style: 'island',
  collisionBoxes, playerSpawn, enemySpawns, mapBounds, landmarks, warnings,
  layout: { island: {...}, crates, barrels, lowWalls, stalls, hero: { campfire } },
  terrain, environment, dressing }
```

---

## 3. 碰撞派生（只写摆放，碰撞自动算）

**不要手写碰撞盒**：`formats/v2.js` 根据摆放 + 下表派生（`ISLAND_FOOTPRINTS`），并叠加：

- 边界岩脊：`islandRingBoxes(terrain.boundary)`（闭合环，留码头缺口）；
- `architecture.extraSolids`（手动微调，少用）；
- 复用道具按 outpost 旧规则（crates/barrels/lowWalls/stalls/campfire）。

| 类型 | 碰撞（w×d×h，y0） |
| --- | --- |
| hut | 5.4×4.8×2.9（底座占 60%），门廊不挡 |
| hutRuins | 4.6×4.0×2.2 |
| fences | 4.3×0.35×1.5（沿 ry 旋转，AABB 取外接） |
| dryingRacks | 3.0×1.7×1.6 |
| walkways | 6.3×1.9×0.28（可踩，玩家能上） |
| totems | 1.1×1.1×3.2 |
| ruinWalls | 6.0×1.2×3.2 |
| ruinArches | 两根 0.8×1.0×5.0 立柱（按跨度分开） |
| ruinTowers | 5.6×5.6×8.7 |
| ruinIdols | 2.7×2.2×2.9 |
| ruinColumns | 0.95×0.95×2.6 |
| shoreRocks | 4.4×4.0×1.8 |
| jetties | 甲板 6.4×9.6×0.30（可踩）+ 两侧栏杆 0.18 宽 |
| canoes | 1.5×4.5×0.8 |
| driftwood | 3.4×1.6×0.7 |
| wrecks | 4.4×6.4×2.3 |
| 树木/灌木/草/竹/芭蕉/蕨/藤/倒木（植被） | **分级处理**：实体植被（巨冠乔木/椰子树/竹丛/倒木）按上表规则派生碰撞；软植被（灌木/芭蕉/蕨/草/藤）**不产生碰撞**（叶卡可穿过） |
| jungleTrees（巨冠乔木） | 树干 1.32×1.32×3.2（s 缩放，y0=0）；板根薄片不挡，盒只包树干本体 |
| coconutPalms（椰子树） | 倾斜树干分两段：0–2 m（世界高度，进 A* 网格）+ 2 m–6.6·s（跟随树干中心线；minY≥1.9 不进 A* 网格） |
| bambooClumps（竹丛） | 每丛按 map 低模的 4 根竹竿各一根 0.34×0.34×2.7（s 缩放）：贴合竹竿本体；整丛大盒会因侧向探针先打到盒外叶卡而报 top-only 空气墙 |
| fallenLogs（倒木） | 沿局部 X 轴 4 段 AABB（断口/中段/根端 + 竖立根板），每段按 ry 旋转，避免整根 5 m 长盒旋转后膨胀 |

> 判定标准：`map-audit` 每个 >0.5 m 的盒必须有贴合可见几何（岩脊模型与盒同参数生成）。
> 植被盒只包树干/竹竿/倒木本体，**不包树冠/叶卡**：一是避免"空气墙"，二是叶卡植被
> 本来就设计成可穿过。软植被（灌木/芭蕉/蕨/草/藤）不产生碰撞盒，由 `world-check`
> 的 island 植被断言守住这条边界。

---

## 4. 视觉模块契约

### 4.1 `src/world/island-terrain.js`

```js
export function buildIslandTerrain(ctx) // 返回 { ground }
```

- 草地盘（r ≤ grassRadius，y=0，`name='ground'`，材质 `jungleGrass` + 程序混合 `leafLitter` 顶点色）；
- 沙滩环（beachInner→landRadius，`beachSand`，与草地 4 m 过渡重叠、y-0.002 防 z-fight）；
- 海底坡（landRadius→bedOuter，下潜 bedDrop，`beachSand`/`mud` 顶点色渐变）；
- 边界岩脊：按 `islandRingBoxes()` **同参数**生成不规则岩石条带（`shoreRock`/`mossStone`，可用 `rockGeo` 拼），缺口留空；岩脊上撒 12–18 丛灌木/蕨做雨林边缘；
- `ctx.ground` 必须指向草地 mesh（map-audit / 子弹 / 玩家落地依赖 `name='ground'`）。

### 4.2 `src/world/island-water.js`

```js
export function buildIslandWater(ctx) // 返回 { mesh, update(time), level }
```

- 大水面（≥360×360）y = `sea.level`，自定义 ShaderMaterial：天空色 fresnel 反射、太阳高光长条、两层正弦波法线、深浅水颜色混合（近岸浅绿松石→远海深蓝）；
- 岸边白浪泡沫带（r≈landRadius±0.6，透明 alpha 噪声滚动）；
- 浅水透光（近岸可看到 seabed 颜色）+ 水下轻微暗角；
- 不参与 raycast/碰撞（`userData.surface` 不设，`collide:false`）。

### 4.3 `src/world/island-ambience.js`

```js
export function buildIslandAmbience(ctx) // 返回 { update(time) }
```

- 花粉/孢子浮尘（复用 `buildDust` 思路，青绿调，低风速）；
- 2–3 条低空薄雾带（半透明平面/粒子，缓慢漂移）；
- 可选：远处 3–5 只盘旋海鸟（简单三角翼）+ 水面反光微粒；
- 全部只做视觉，不进 collideMeshes。

### 4.4 `src/world/island-props.js`（Lead 已实现）

`ensureBatches(ctx)` → 依次调用 `ISLAND_MODELS[*].module.buildWorld` → 复用道具（crate/barrel/lowWall/stall/campfire）→ 不调用 outpost 的 architecture/props/dressing。

---

## 5. 天空/光照（清晨 06:40–08:00）

`environment.json` 直接复用 v1 environment 解析器（`buildSky/buildLights/buildEnvironment`）：

```jsonc
{
  "sky": { "sunDirection": [0.86, 0.20, 0.46], "zenith": [0.07,0.20,0.44], "horizon": [1.30,0.86,0.52],
           "dust": [0.86,0.78,0.58], "sunColor": [2.7,1.9,1.1], "cloudColor": [1.55,1.32,1.08],
           "groundColor": [0.20,0.24,0.14], "domeRadius": 340 },
  "fog": { "color": "#c8d8c4", "density": 0.0048 },
  "background": "#d6c9a8",
  "lights": { "sun": { "color": "#ffdcb0", "intensity": 3.2, "distance": 190,
              "shadow": { "ortho": [-80,80,80,-80], "near": 40, "far": 420, "bias": -0.00045, "normalBias": 0.055, "radius": 2.4 } },
              "hemisphere": { "skyColor": "#8fbfe0", "groundColor": "#8a9458", "intensity": 0.85 },
              "ambient": { "color": "#4b5240", "intensity": 0.20 },
              "bounce": { "color": "#ffcf9a", "intensity": 0.45, "position": [80,20,40], "target": [0,0,0] } },
  "ambience": { "pollen": [420, 90], "mist": 3, "birds": 4 }
}
```

- 阴影正交框必须覆盖 ±80（岛半径 52 + 建筑高度）。
- 雾偏青绿湿气，density 0.0048（可视 ~200 m）。

---

## 6. 波次 / 关卡入口

- `src/config/waves.js` 新增 `ISLAND_01_WAVES`（15 波，Boss 规则沿用 `WAVE_RULES`：每 5 波 `boss`，去 `warlord`），
  `STAGE_WAVES['island-01']`，标签用岛屿语气（滩头/雨林/遗迹/终焉环礁）。
- `src/config/stages.js` 追加 stage index 2：`id='island-01'`、`mapId='island-01'`、`waveSet='island-01'`、
  `unlockedByDefault: true`（方便直接选关；正式 campaign 可改 false）。
- 测试入口：`http://127.0.0.1:8080/?dev=1&stage=island-01`（也会自动带 `map=island-01`）。

---

## 7. 数量预算（摆放目标）

> v2 迭代（用户反馈"植被多一点、地面空旷、没掩体、遗迹要复杂"）：植被与遗迹数量整体上调，
> 并新增**复用道具掩体**（石垒矮墙/货箱/木桶/摊位均有真实碰撞，可作掩体）。

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| jungleTrees | 52–64 | 雨林主体，r 14–48，成丛（3–5 株），避开村庄/遗迹/栈桥通道 |
| coconutPalms | 16–22 | 沙滩环 r 40–50 + 村口 |
| bananaPlants | 20–26 | 村边/林缘 |
| fernClumps | 30–38 | 林下层 |
| bambooClumps | 16–20 | 村后/林间 |
| bushes | 42–52 | 边界岩脊 + 林缘 + 村舍旁 |
| vineDrapes | 26–34 | 大树/遗迹/岩脊 |
| fallenLogs | 8–12 | 林间 |
| grassTufts | 170–210 | 全岛地被点缀 |
| huts / hutRuins | 3–4 / 2–3 | 草村 |
| fences | 7–9 | 村界 |
| dryingRacks | 2–3 | 村内 |
| walkways | 2–3 | 村中主干道 |
| totems | 2–3 | 村口 + 林心 + 遗迹 |
| ruinWalls / Arch / Tower / Idol / Column | 7–9 / 2 / 1–2 / 2 / 12–16 | 北部多房间神殿群（柱廊 + 侧室 + 双拱 + 双石像 + 塔） |
| shoreRocks | 9–12 组 | 沙滩/西岸 + 少量内陆礁石露头 |
| jetties | 1 | 东南缺口 |
| canoes / driftwood / wrecks | 2 / 2–3 / 1 | 南滩/西岸 |
| **掩体（reuse）** | crates 14–20 · barrels 12–18 · lowWalls 8–12 · stalls 3–4 · campfires 1–2 | 石垒矮墙 1.25m、货箱 0.82m、木桶 0.94m 均可作掩体 |

敌人出生点 ≥ 20（`resolve.minCount=18`），全部在 r 24–50、避开 collider；Boss 需要 1.45 m 环形空地。

---

## 8. 验收命令

```powershell
node scripts/world-check.mjs                     # 数据格式/接线/碰撞/spawn 静态校验（含 island-01）
node .scratch/island-map/check-layout.mjs        # 摆放统计 + 碰撞/出生点/重叠体检 + ASCII 俯视图
node scripts/check.mjs                           # 全量静态检查（语法/文档/地图/关卡/存档）
$env:MAP='island-01'; node scripts/map-audit.mjs # 空气墙/可达性/窄道/浮空/落地（大地图网格自适应）
$env:GPU='1'; node .scratch/island-map/probe.mjs  # 12 个固定机位 + 单帧渲染统计（raw render）
$env:GPU='1'; node .scratch/island-map/hero.mjs   # 10 张实机 postfx 截图（1600×900）
$env:GPU='1'; node .scratch/island-map/qa/waves.mjs   # 15 波全流程（Boss 5/10/15 → victory → cleared）
$env:GPU='1'; node .scratch/island-map/qa/perf.mjs    # medium/high 四机位性能
node scripts/world-verify.mjs --tag=after --gpu=1     # outpost-07 回归抓取（--compare 对比）
```

---

## 9. 写作用域（并行施工，互不重叠）

| 成员 | 写作用域 |
| --- | --- |
| Lead | `ISLAND_MAP_SPEC.md`、`src/world/data/**`、`src/config/maps/index.js`、`src/world/index.js`、`src/world/update.js`、`src/world/island-props.js`、`src/world/island-shape.js`、`src/world/architecture.js`（island batch 注册）、`src/config/waves.js`、`src/config/stages.js`、`src/config/maps/island-01/map.json`、`spawns.json`、`dressing.json`、`environment.json`（收尾调色）、`scripts/check.mjs`、`shots/map/**`、`README.md`、`src/config/maps/README.md` |
| terrain | `src/world/island-terrain.js`、`src/config/maps/island-01/terrain.json` |
| water | `src/world/island-water.js`、`src/world/island-ambience.js`（Lead 接手收尾 environment.json） |
| arch | `src/config/maps/island-01/architecture.json` |
| flora | `src/config/maps/island-01/props.json` |
| qa | `scripts/map-audit.mjs`（仅 grid/map 参数最小改动）、`.scratch/island-map/qa*`、`shots/map/island/qa/**` |

禁止：改对方的文件；改 outpost-07/test-range 的任何 JSON；改 `src/models/**`（模型已完成，除非 Lead 指派）。
所有摆放 JSON 由 Lead 的 `check-layout.mjs` 自动体检；违规（重叠/出界/堵门）会报 ERROR。

---

## 10. 交付状态（2026-11-14）

### 已完成

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 地图数据 | `src/config/maps/island-01/`（7 个 JSON） | map@2 全部 6 个部件 + manifest；`architecture.json` / `props.json` 由两位数据作者扩写到 §7 目标 |
| 新格式适配器 | `src/world/data/formats/v2.js` | 归一化 island layout、按 §3 footprint 自动派生碰撞盒 + 实体植被树干碰撞（`VEGETATION_FOOTPRINTS`）+ 环礁边界环（含码头缺口）、复用道具碰撞、"每盒来源 kind" 标签 |
| 校验 | `src/world/data/index.js`（`validateIslandMapData`） | island 专属校验：地形/边界/海面数值、25 个摆放数组、地标/出生点/半径 |
| 岛形数学 | `src/world/island-shape.js` | 纯数据（无 three）：`resolveBoundary` / `boundarySegments` / `islandRingBoxes` / 缺口判定 |
| 地形 | `src/world/island-terrain.js` + `terrain.json` | 草地/落叶/沙滩湿沙/贝壳碎石/海底坡/珊瑚/环礁礁岩带（成簇下沉变尺寸、每段可见石、缺口门柱）；57k tri |
| 水面 | `src/world/island-water.js` | 跨向波浪、深浅水色、菲涅尔天空反射、太阳碎金、近岸白浪环；2 draw call |
| 氛围 | `src/world/island-ambience.js` | 花粉浮尘 / 薄雾带 / 海鸟（无碰撞不投影） |
| 装配 | `src/world/island-props.js` | 25 个岛图模型 + 复用道具（货箱/木桶/矮墙/摊位/篝火）按 layout 装配 |
| 构建分支 | `src/world/index.js` + `update.js` | `ctx.data.style === 'island'` 走海岛构建链（地形→摆放→水→氛围），含进度文案；水面/氛围按帧更新 |
| 波次 / 关卡 | `src/config/waves.js`、`stages.js` | `ISLAND_01_WAVES`（15 波，5/10/15 Boss）+ `STAGE_WAVES['island-01']`；关卡 02 ATOLL 09（默认解锁，`?stage=island-01` 直达） |
| 注册 | `src/config/maps/index.js` | `MAP_SOURCES['island-01']`，`DEFAULT_MAP_ID` 仍为 `outpost-07` |
| 工具 | `.scratch/island-map/` | `check-layout.mjs`（摆放体检+ASCII）、`probe.mjs`（12 机位）、`hero.mjs`（实机截图）、`qa/{tour,waves,perf}.mjs` |
| 文档 | `README.md`、`src/config/maps/README.md` | map@2 格式说明、地图清单、命令与已知限制 |

### 最终数据（v2 反馈迭代后）

- 地图：140×140 m（含水域），可玩环带 r≤52 ≈ **8,494 m² ≈ 1.95×** 沙漠图（66×66=4,356 m²）
- 碰撞盒 **470** 个（结构 78 + 复用掩体 59 + 实体植被 219 + 环礁边界环 114），22 个敌人出生点（全部 clear），9 个地标
- 摆放（v2 加密）：树 **63**（21 丛×3）· 椰树 20 · 芭蕉 24 · 蕨 34 · 竹 18 · 灌木 46 · 藤 30 · 倒木 11 · 草簇 200；掩体：石垒矮墙 10 · 货箱 17 · 木桶 16 · 摊位 3 · 篝火 1
- 神殿群：9 残墙 / 2 拱门 / 1 石塔 / 2 石像 / 16 石柱 / 东西侧室 / 中轴柱廊；遗迹模型加细节后 tri 7.6k/9k/16.6k/5.2k/4.2k（wall/arch/tower/idol/column）
- 天空/雾气：天顶蓝 [0.14,0.40,0.76]、地平雾 #a8bcc4 @0.0076、云层 `cloudOpacity 0.35`（更蓝的天空 + 大量湿雾散射）；5 条大尺度低空雾带 + 花粉 460 + 海鸟 6；环境光 0.4 / 半球光 1.28 提亮阴影
- 15 波 / 每 5 波 Boss（wave 5/10/15，Boss 替换 warlord），通关写 `cleared=true`
- 性能（720p）：draw calls **135–172**；probe `frameTris 2.85–3.20 M`（含阴影 pass，双画 caster）、**场景本体 1.60 M**；纹理 62 / 几何 98
- 质检：`world-check` / `check.mjs` / `check-layout` 全绿；map-audit 可玩环玩家可达 99.7%（2 处新增围合院角死区 P2）、0 浮空、0 bad floor、0 console error，空气墙 4 条均预期（栈桥护栏×2/晒架×2）；outpost-07 回归数据逐元素一致、截图差异仅动画相位

### 已知 P1 / P2（不阻塞发布）

- **P1 视觉**：环礁岩脊的礁石仍偏"低模锥块"（成簇/尺寸/下沉已做，但形状重复感还在）——下一轮美术迭代可换更细的礁岩模型或增加形状变体。
- **P2**：岛图 4 条 map-audit 空气墙均为预期障碍（栈桥护栏 ×2、晒架 ×1–2）；`robot` 可达率按全图统计 37–39%，但**可玩环 r≤52 内四象限 99–100% 可达**（环外海面/礁石计入不可达属正常口径；99.5% 少量死区来自新增矮墙/围合院角）；JETTY 地标在栈桥甲板上，机器人不上桥属设计取舍。
- **P2（植被碰撞权衡）**：实体植被碰撞落位后，审计的安全余量口径 `robot_r105_nav`（r=1.05 m）ring 97.5%→2.6%、22 个 spawn 不可达；同理 boss 半径 1.35 按 safety 口径复算 97.9%→1.6%。实际游戏只建 light 0.58 / heavy 0.72 两套 NavGrid（`src/enemies.js navFor()`），Boss 用 heavy 网格 + 独立 spawn 搜索（clearance 1.45），按真实底盘半径复算游戏内网格零回归（rifleman 99.5→99.4 / heavy 99.5→99.4 / warlord 97.3→96.2）。**未来若新增半径 >1.05 m 的底盘需重新评估 jungle 寻路**。
- **P2**：天空云层已通过 `cloudOpacity=0.35` 大幅压低，仅极低机位保留极淡云带；草纹理在近距离有斜向笔触感、树冠仍有卡片感。
- 修复记录：`barrel.js` 的 outpost 站点第二排木桶硬编码坐标会导致岛图 4 个木桶悬空（0.94m），已改为仅 outpost 生效；`v2` 篝火碰撞高度 0.55→0.45 消除矮障碍空气墙误报；`driftwood` footprint 3.4×1.5→2.2×0.65 贴合枯木；`jungle-tree`/`vine-drape` 的内联注释/标签乱码已修复。
- 修复记录（用户反馈"小岛树木等模型没有碰撞体积"）：`formats/v2.js` 新增 `VEGETATION_FOOTPRINTS`，为实体植被派生树干级碰撞盒（巨冠乔木 63、椰树 20×2 段、竹丛 18 丛×4 竹竿、倒木 11×4 段，共 **219** 盒；见 §3 表）；软植被（灌木/芭蕉/蕨/草/藤）保持可穿过。碰撞盒 251→470；`world-check` 追加 island 植被碰撞回归断言（实体植被必须有盒、软植被必须无盒、盒宽不得失控）。map-audit 复核：空气墙维持 4 条预期（0 新增 top-only）、玩家可玩环 r≤52 可达 99.7%（与改造前一致）、机器人 r=0.58 环 99.4%（-0.1%）、0 console error；r=1.05 安全余量变体因新增树干障碍从 97.5% 降至 2.6%（实际游戏只用 0.58/0.72 两套 NavGrid，见 §10 说明）。

---

## 11. 环境音（v3：岛屿音床）

### 目标与差异

沙漠前哨与热带岛屿使用两套完全不同的**程序化环境音床**，由地图的 `style` 标签自动选择：

| | OUTPOST 07（沙漠） | ATOLL 09（岛屿） |
| --- | --- | --- |
| 底噪 | 棕噪低通风床（320 Hz）+ 高频气流（880 Hz） | 深海涌浪（棕噪低通 430 Hz）+ 碎浪（带通 820 Hz）+ 浅滩拉回（高通 1.5 kHz） |
| 中高频 | 阵风事件、远处金属吱呀、无线电杂音 | 树叶沙沙（带通 3.3 kHz + 阵风事件）、湿热虫鸣（5.6 kHz 脉冲） |
| 点事件 | 潜行声、金属吱呀、无线电静电、阵风 | 程序化鸟鸣（啁啾串 / 下降颤音 / 双音呼唤，含远处鸟群）、浪涌拍岸 + 泡沫嘶声、叶浪阵风 |
| 频谱重心实测 | ≈ 190 Hz | ≈ 1.1–1.7 kHz |

### 实现

- `src/audio.js`
  - `worldStyle = 'outpost' | 'island'`；`_startAmbience()` 分派 `_startDesertAmbience()` / `_startIslandAmbience()`；
  - `_startIslandAmbience()` 建 5 条常驻层：`ocean`（0.17）、`surf`（0.15）、`lap`（0.03）、`leaves`（0.028）、`hush`（0.007），各带 0.05–0.33 Hz LFO 呼吸，立体声声像错开；
  - `_advanceIslandAmbience(dt)` 调度点事件：`bird` 每 3–7.5 s、`wave` 每 4.5–10.5 s、`leaves` 每 5–12 s、`flock` 每 12–26 s；`_islandBird()` 三种鸟叫 / `_islandFlock()` / `_islandWave()`（低频涌浪 + 泡沫嘶声）/ `_islandLeafGust()`（带通扫频）；
  - `setWorldStyle(style)`：可在 `init()` 前后调用；运行中调用会淡出旧音床、停止旧循环节点并重建新音床（双向热切换）。
- `src/world/index.js`：world 导出 `style: 'island' | 'outpost'`（由 `data.style` 决定）。
- `src/main.js`：world 构建完成后 `audio.setWorldStyle(world.style === 'island' ? 'island' : 'outpost')`，早于 `startStage()` 的 `audio.init()`，因此进关即用正确音床。

### 验证（`.scratch/audio/audio-check.mjs`）

- 岛图：`style=island`、island 音床存在、desert 音床未泄漏；16 s 采样内 **鸟鸣 4–5 次 / 浪涌 2 次 / 叶浪 2–3 次 / 鸟群 1 次**；输出 RMS 0.056–0.063、频谱重心 1.1–1.7 kHz；
- 前哨：`style=outpost`、desert 风床存在、island 音床未泄漏；RMS 0.042、频谱重心 ≈188 Hz；
- 热切换：island→outpost→island 双向重建正确；
- 实机游玩（直接进岛图、点击解锁 AudioContext）0 console error、音频上下文 running、正确音床；`node scripts/check.mjs` / `world-check` 保持全绿。

### 已知限制

- 环境音是**全局床**而非空间声源：不随玩家靠近海岸 / 树林实时改变比例。若后续需要，可在 `update()` 里按玩家位置给 `surf/leaves` 做距离与朝向加权；
- 天气（雨、雷、不同时段）暂无变体，音床参数固定为"清晨湿雾"氛围。




