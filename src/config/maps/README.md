# SANDSTRIKE 地图配置（`src/config/maps/`）

本目录是关卡格式的唯一数据源：**一张地图 = 一个文件夹**，里面是一个清单（`map.json`）加若干可组合的
JSON 部件（terrain / environment / architecture / props / dressing / spawns）。游戏启动时由
`src/world/data/` 的加载器按 `map.json.format` 分派适配器，把 JSON 规范化成世界构建器消费的
`ctx.data`（旧的 `buildWorldData()` 返回值 + 新增的 terrain/environment/dressing）。

- 地图列表 / 默认地图：`index.js`（`MAP_SOURCES`、`DEFAULT_MAP_ID`）
- 加载与校验：`src/world/data/index.js`（`loadMap(id)`、`listMaps()`、`validateMapData()`）
- 格式适配器：`src/world/data/formats/v1.js`（`sandstrike/map@1`）
- 碰撞/出生点/警告推导：`src/world/data/collision.js`

现有地图：

| id | 名称 | 说明 |
| --- | --- | --- |
| `outpost-07` | OUTPOST 07 / 沙暴前哨第七区 | 默认地图。完整沙暴前哨关卡（A/B 点、中门、A 大道、B 隧道、庭院、井），格式 `sandstrike/map@1`。 |
| `test-range` | TRAINING RANGE / 训练靶场第九区 | 第二张地图示例：44×44m 封闭靶场，复用同一套构建器与模型资产，用来验证"一张地图一个文件夹 + 独立 JSON 组合"的多地图能力，也是新地图的参考模板。 |
| `island-01` | ATOLL 09 / 碧潮环礁·第九区 | 热带海岛关卡（格式 `sandstrike/map@2`）：四面环水的封闭小岛，可玩陆地约 2× 沙漠图面积，雨林 + 草村 + 遗迹 + 海岸；15 波、每 5 波 Boss。设计/施工契约见根目录 `ISLAND_MAP_SPEC.md`。 |

运行时可用 `?map=<id>` 选择地图；未知 id 会打警告并回落到 `DEFAULT_MAP_ID`。

```
src/config/maps/
  index.js                # 注册表：静态 import 每张地图的 JSON + DEFAULT_MAP_ID
  README.md               # 本文件
  outpost-07/
    map.json              # 清单：format/id/name/bounds/playerSpawn/parts
    terrain.json          # 地面/石板/沙丘/远山/天际线/远景雾面
    environment.json      # 天空/太阳/雾/背景/灯光/环境反射/氛围
    architecture.json     # 建筑布局 + 显式结构碰撞体
    props.json            # 道具/英雄道具布局 + 显式道具碰撞体
    dressing.json         # 贴花/海报/灯笼/点光/烟雾/横幅请求
    spawns.json           # 玩家/敌人出生候选、地标、解析参数
  test-range/             # 第二张地图（同样的 7 个 JSON 部件，内容独立）
  island-01/              # 第三张地图：ATOLL 09 热带海岛（format sandstrike/map@2）
    map.json              # 清单：format/id/name/bounds/playerSpawn/parts
    terrain.json          # 岛形/沙滩/海底/环礁岩脊/海水
    environment.json      # 清晨天空/光照/雾/氛围
    architecture.json     # 村庄/遗迹/海岸结构摆放
    props.json            # 植被摆放 + 复用道具
    dressing.json         # 氛围覆盖
    spawns.json           # 玩家出生/敌人候选/地标/解析参数
```

## 通用约定

- 文件必须是 **UTF-8 无 BOM** 的 JSON；不要留注释、尾逗号。
- `map.json.id` **必须等于文件夹名**，加载器会校验不一致并报错。
- `format` 决定用哪个适配器：`"sandstrike/map@1"`（前哨/训练场）或 `"sandstrike/map@2"`（热带海岛）。
  新增格式时同时新增 `src/world/data/formats/<name>.js` 并在 `src/world/data/index.js` 的 `ADAPTERS` 里注册。
- 长度单位是米；坐标系与游戏一致（地面 y=0，出生点在南侧 +Z，北侧 -Z，东 +X，西 -X）。
- **颜色约定**：
  - 需要 `THREE.Color#setRGB` 的线性值 → `[r, g, b]` 数组（可大于 1，表示 HDR）；
  - 需要十六进制颜色的地方 → `"#rrggbb"` 字符串。
  - 数据层不 import three，原样透传给消费方，不做色彩空间转换。
- **区间数组统一 `[min, max]` 语义**，对应旧代码 `min + rng * (max - min)`。
- 数组/对象的顺序在部分位置有语义（见 dressing / arches 说明），改动前先读对应小节。
- 大多数字段都有缺省值，且**缺省值等于 `outpost-07` 的旧数值**（见
  `src/world/data/formats/v1.js` 的 `TERRAIN_DEFAULTS` / `ENVIRONMENT_DEFAULTS` /
  `DRESSING_DEFAULTS` / `SPAWN_RESOLVE_DEFAULTS`），新地图只需覆盖想改的字段。

## 各文件职责与字段参考

### `map.json` — 清单

```json
{
  "format": "sandstrike/map@1",
  "id": "outpost-07",
  "name": "OUTPOST 07",
  "subtitle": "沙暴前哨 · 第七区",
  "description": "一句话关卡简介（loading / 文档用）",
  "bounds": { "minX": -33, "maxX": 33, "minZ": -33, "maxZ": 33 },
  "playerSpawn": { "x": 0, "y": 0, "z": 26, "yaw": 0 },
  "parts": { "terrain": "terrain.json", "environment": "environment.json",
             "architecture": "architecture.json", "props": "props.json",
             "dressing": "dressing.json", "spawns": "spawns.json" }
}
```

| 字段 | 说明 |
| --- | --- |
| `format` | 格式 id，分派适配器用；缺省 `sandstrike/map@1` |
| `id` | 地图 id，必须等于文件夹名（`?map=<id>` 用它） |
| `name` / `subtitle` / `description` | 展示用文案（菜单/加载界面/文档） |
| `bounds` | 地图逻辑边界（`world.mapBounds`） |
| `playerSpawn` | 玩家出生点（`x,y,z` + `yaw` 弧度） |
| `parts` | 部件文件名清单（文档性引用；实际 import 在 `index.js`） |

### `terrain.json` — 地形

```json
{
  "ground":  { "size": 69.5, "segments": 40, "uvTile": 2.7,
               "color": { "base": 0.82, "spread": 0.32, "min": 0.55, "max": 1.08,
                          "warmth": { "gBase": 0.98, "gAmp": 0.03, "gFreq": 0.9, "b": 0.95 } } },
  "paving":  { "color": [0.8, 0.72, 0.6], "worldScale": 3.2,
               "patches": [[x, z, w, d, y], "..."] },
  "dunes":   { "size": 430, "segments": 110, "uvTile": 9.5,
               "nearMask": [38, 82], "farMask": [75, 190],
               "baseHeight": -0.45, "farLift": 9.0, "heights": [2.2, 5.4, 3.1, 4.5],
               "color": { "base": 0.8, "perHeight": 0.045, "heightMid": 4, "farDarken": 0.08,
                          "min": 0.55, "max": 1.06, "rgb": [1, 0.97, 0.92] } },
  "mesas":   { "seed": 9182, "specs": [[x, z, h, r, sides], "..."] },
  "skyline": { "seed": 4455, "count": 34, "distance": [44, 78], "angleJitter": 0.11,
               "width": [4, 15], "depth": [4, 15], "height": [4.5, 13.5],
               "parapetEvery": 3, "minaretEvery": 6 },
  "haze":    { "radius": 900, "segments": 32, "color": [0.56, 0.36, 0.20], "y": -1.1 }
}
```

- 可玩的沙地是固定 `size=69.5`、`segments=40` 的平面，`uvTile` 控制贴图世界尺寸。
- `ground.color`：顶点色 = `clamp(base + (noise-0.5)*spread, min, max)`，`warmth` 控制 G/B 通道偏移。
- `paving.patches`：每项 `[x, z, 宽, 深, 抬高y]`，作为一块石板平面合并绘制。
- `dunes`：大范围沙丘的尺寸/分段/贴图密度/内外遮罩（`[min,max]` 米）、基准高度、远处抬升；
  `heights` 是程序噪声的 4 个振幅。沙丘顶点色由 `base/perHeight/heightMid/farDarken/min/max/rgb` 决定。
- `mesas.specs`：远景台地 `[x, z, 高, 半径, 边数]`，`seed` 固定随机。
- `skyline`：城墙外的土坯剪影环（数量/距离/角度抖动/宽深高区间/角楼与尖塔间隔）。
- `haze`：地平线外的远景沙雾圆盘（半径/分段/颜色/高度）。

### `environment.json` — 天空 / 光照 / 氛围

```json
{
  "sky": { "sunDirection": [-0.893, 0.305, 0.333], "zenith": [0.10, 0.235, 0.52],
           "horizon": [1.34, 0.78, 0.36], "dust": [0.52, 0.29, 0.14],
           "sunColor": [2.6, 1.7, 0.9], "cloudColor": [1.5, 1.16, 0.88],
           "groundColor": [0.26, 0.17, 0.10], "domeRadius": 340 },
  "fog": { "color": "#d7a06c", "density": 0.0104 },
  "background": "#d8a877",
  "lights": {
    "sun": { "color": "#ffd2a0", "intensity": 3.55, "distance": 130, "target": [0, 0, -2],
             "shadow": { "ortho": [-46, 46, 46, -46], "near": 30, "far": 290,
                         "bias": -0.00045, "normalBias": 0.055, "radius": 2.2 } },
    "hemisphere": { "skyColor": "#8fb2d8", "groundColor": "#cf9a60", "intensity": 0.82 },
    "ambient": { "color": "#5b4130", "intensity": 0.17 },
    "bounce": { "color": "#ffb27a", "intensity": 0.58, "position": [75, 18, -55], "target": [0, 0, 0] },
    "sunPulse": { "amplitude": 0.08, "speed": 0.05 }
  },
  "environmentMap": { "intensity": 0.55, "groundColor": [0.24, 0.16, 0.095],
                      "cardColor": [1.4, 0.9, 0.55], "cardDistance": 55,
                      "groundRadius": 120, "sphereRadius": 80, "blur": 0.03 },
  "ambience": { "lanternGlowScale": 620, "dustSpread": 64, "dustY": [0.2, 8.7] }
}
```

- `sky.sumDirection` 是**未归一化**的方向，消费方负责 `normalize()`；`sky` 内其它 `[r,g,b]` 直接
  `Color#setRGB`。`domeRadius` 是天穹半径（比 `far` 略小即可）。
- `lights.sun.distance` 是太阳位置距离（方向 × distance）；`shadow.ortho` 顺序是
  `[left, right, top, bottom]`。`sunPulse` 是 `updateWorld()` 里的亮度呼吸：`intensity + sin(time*speed)*amplitude`。
- `environmentMap` 是 PMREM 环境反射的离线场景参数（强度/地面色/暖色补光球位置/半径/模糊）。
- `ambience.dustSpread` 是沙尘粒子水平散布（米），`dustY` 是高度区间；`lanternGlowScale` 是灯笼
  glow 点精灵的缩放。

### `architecture.json` — 建筑 + 结构碰撞

键与旧 `layout` 完全同名同结构（数值照抄），每项都是构建器直接消费的数组：

| 键 | 元素形状 | 说明 |
| --- | --- | --- |
| `walls` | `{x,z,w,d,h}` | 中门横墙 |
| `gatePiers` | `{x,z,w,d,h}` | 中门门柱 |
| `boundary` | `{x,z,w,d,h}` | 外墙 |
| `towers` | `{x,z,w,d,h,kind}` | 四角塔 |
| `buildings` | `{x,z,w,d,h,style,rows}` | 广场两侧商铺 |
| `blocks` | `{x,z,w,d,h,lane,door}` | 仓库块；`door` 可为 `null` 或 `{z,w,h}` |
| `lowWalls` | `{x,z,w,d,h,surface}` | 矮掩体墙（`surface` 进碰撞体材质） |
| `pillars` | `{x,z,w,d,h,style}` | 柱廊 |
| `tunnelPiers` | `{x,z,w,d,h}` | B 隧道拱腿 |
| `arches` | 见下 | **渲染顺序**的拱门全表（商铺过道 + 站点拱门 + 中门门洞） |
| `tunnelArches` | `{x,z,span,height,depth,pierW,rot,solidPiers,style}` | B 隧道拱 |
| `siteArches` | 同上 + `cell/label` | A/B 站点独立拱门（也会出现在 `arches` 中，两处需同步） |
| `stalls` | `{x,z,ry}` | 集市摊位 |
| `solids` | `{x,z,w,d,h,surface,y0?}` | 无推导规则的显式碰撞体（隧道木柱、中门门扇、B 点手推车等） |

`siteArches` 中 `solidPiers: true` 的拱门会按规则自动生成两根门柱碰撞体；其余碰撞由
`src/world/data/collision.js` 从上述布局推导，**不要手写 collisionBoxes**。

### `props.json` — 道具 / 英雄道具

```json
{
  "hero": { "well": {}, "truck": {}, "campfire": {}, "flagpoles": [], "windmill": {},
            "watchtower": {}, "radar": {}, "monument": {}, "aLongShade": {}, "aPlatform": {},
            "bWreck": {}, "cartPlaza": {}, "aLongCart": {} },
  "crates": [{ "x": -2.6, "z": 23.4, "s": 0.95, "ry": 0.2, "stack": 2 }],
  "barrels": [{ "x": -18.2, "z": 28.6 }],
  "sandbagRuns": [[-5.6, 21.6, 5.2, 1.15, 1.05]],
  "palms": [{ "x": 13.4, "z": 18.2, "s": 1.0 }],
  "lampPosts": [[-7.8, 20.6]],
  "looseCrates": [{ "x": -0.6, "z": 30.2, "ry": 0.3, "s": 0.62 }],
  "tireStacks": [[-12.4, 22.6, 3]],
  "sackPiles": [[-15.8, -23.2]],
  "solids": []
}
```

- `hero` 的 **13 个键全部必需**（碰撞规则会读 `hero.*` 的尺寸）；缺键时 `loadMap()` 会抛错。
  - `well {x,z,r}`、`truck {x,z,yaw}`、`campfire {x,z}`、`flagpoles [{x,z,h}]`、
    `windmill {x,z}`、`watchtower {x,z,w,d,h}`、`radar {x,z}`、`monument {x,z}`、
    `aLongShade {x,z,zs[]}`、`aPlatform {x,z,w,d,h}`、`bWreck {x,z}`、
    `cartPlaza {x,z,w,d}`、`aLongCart {x,z,w,d}`。
- `crates`：`{x,z,s,ry,stack}` —— 碰撞足迹 `s*1.02`、总高 `s*0.82*stack`。
- `barrels`：JSON 只存 `{x,z}`，**yaw 由代码公式推导** `(x*7.3 + z*3.1) % 2π`（不要写 yaw）。
- `palms`：JSON 只存 `{x,z,s}`，**ry 自动推导** `(x*13.7 + z*5.3) % 2π`。
- `sandbagRuns`：`[x, z, w, d, h]`，一条沙袋行一个碰撞体。
- `lampPosts`：`[x, z]`，每根自动生成 0.32×0.32×3.4 碰撞体。
- `looseCrates`：`{x,z,ry,s}`，视觉尺寸 `s`；碰撞用一个 `s*1.02` 的方盒、高 `s*0.82`。
- `tireStacks`：`[x, z, count]`，碰撞高 `0.31 + (count-1)*0.3`。
- `sackPiles`：`[x, z]`，碰撞 1.6×1.2×0.8。
- `solids`：显式道具碰撞体（两个木料堆、两个托盘堆、两个废料堆等），形状同 architecture.solids。

### `dressing.json` — 站点级装饰请求

```json
{
  "decals":  [{ "x": 17.6, "y": 0.045, "z": -25.3, "rx": -1.5708, "ry": 0.06,
                "cell": "siteA", "w": 5.4, "h": 5.4, "opacity": 1 }],
  "posters": [{ "x": -6.2, "y": 2.2, "z": 32.86, "ry": 3.1416,
                "cell": "water", "w": 1.1, "h": 2.0 }],
  "site": {
    "lanterns": [{ "x": 17.5, "y": 3.15, "z": -20.3, "kind": "warm", "size": 0.32, "hang": 4.9 }],
    "lights":   [{ "x": 17.5, "y": 3.2, "z": -21.0, "color": "#ffa050",
                   "intensity": 11, "distance": 12, "kind": "flicker" }],
    "decals":   [{ "x": 17.5, "y": 4.55, "z": -21.95, "rx": 0, "ry": 0,
                   "cell": "warn", "w": 1.4, "h": 1.4, "opacity": 0.7 }]
  },
  "smoke": [],
  "banners": [{ "key": "a", "x": 17.5, "y": 4.4, "z": -32.84, "ry": 0,
                "w": 3.2, "h": 5.6, "sway": 0.05, "anchor": "top" }]
}
```

分组对应旧函数，**push 顺序会影响合并后的几何顺序**，不要随意调整组内顺序：

| 组 | 旧函数 | 说明 |
| --- | --- | --- |
| `decals` | `buildSiteStencils()` | 地面/墙面贴花全部请求（`cell` 是贴图图集格子名；`rx=-π/2` 为地面贴花） |
| `posters` | `buildPosterRequests()` | 海报板请求（`cell` 同理） |
| `site.lanterns` | `buildSiteDressing()` | 站点灯笼（`hang` = 吊杆顶端高度，可省略） |
| `site.lights` | `buildSiteDressing()` | 站点点光（`kind: "flicker"` 会闪烁；`color` 可用 `"#rrggbb"`） |
| `site.decals` | `buildSiteDressing()` | 站点贴花（在 decals 组之前 push，因为该函数更早执行） |
| `smoke` | 地图级烟雾 | 旧代码为空；模型自带烟雾仍在模型代码里 |
| `banners` | `buildCloths()` 的 `siteBanners` | `ctx.stage`（模型预览）时为空的那些横幅 |

模型自带（门、井、棚、隧道、旗帜、橱窗等）的请求仍留在各模型 builder 代码里，**不要**搬进本文件。

### `spawns.json` — 出生点 / 地标 / 解析参数

```json
{
  "candidates": [[0, 15.5, "PLAZA SOUTH"], "..."],
  "landmarks": [{ "x": 0, "z": 26.0, "name": "STAGING" }],
  "resolve": { "clearance": 1.45, "playerMinDistance": 4.5, "searchRadius": 8.0,
               "step": 0.5, "angleSteps": 24, "validateClearance": 1.1,
               "playerClearance": 0.9, "minCount": 8 }
}
```

- `candidates`：`[x, z, 标签]`。候选点若被碰撞体挡住，会用螺旋搜索在周围找空位（半径从
  `step` 到 `searchRadius`、每圈 `angleSteps` 个方向，且离玩家出生点 > `playerMinDistance`）；
  找不到的候选会被丢弃。
- `landmarks`：AI/UI 用地标 `{x,z,name}`。
- `resolve`：`clearance` 出生点留空，`validateClearance` 校验警告留空，`playerClearance` 玩家出生点
  留空，`minCount` 少于多少会告警。缺省即上表数值（也是旧地图的硬编码值）。
- 警告（`data.warnings`）由碰撞体 + 解析结果自动生成，无需手填。

### `sandstrike/map@2` — 热带海岛格式（`island-01`）

第二套关卡格式，专门服务"四面环水的封闭小岛"。文件夹仍然只需上面 6 个部件，但每个部件的语义不同
（完整设计见仓库根目录 **`ISLAND_MAP_SPEC.md`**）：

| 部件 | map@2 语义 |
| --- | --- |
| `map.json` | 同 map@1，但 `format` 写 `"sandstrike/map@2"`，`bounds` 建议 ±70 |
| `terrain.json` | `island`（草地/沙滩/水线半径、seed、segments）+ `sea`（水位/海底/深浅水色）+ `boundary`（r=52 环礁岩脊：segments/height/thickness/gap）+ `colors` |
| `environment.json` | 与 map@1 同构（天空/太阳/雾/灯光），额外 `ambience`（pollen/mist/birds） |
| `architecture.json` | `village` / `ruins` / `shore` 三组摆放数组（房屋/遗迹/海岸结构），可选 `extraSolids` |
| `props.json` | `flora`（9 种植被摆放）+ `reuse`（crates/barrels/lowWalls/stalls/campfires） |
| `dressing.json` | 氛围覆盖（pollen/mist/birds 数量）；map@2 不建前哨贴花/横幅 |
| `spawns.json` | `playerSpawn` + `enemies: [{x,z,label}]` + `landmarks` + `resolve`（同 map@1 参数） |

关键约定（与 map@1 最大区别）：

- **只写摆放，不写碰撞**：`src/world/data/formats/v2.js` 按 `ISLAND_MAP_SPEC.md §3` 的 footprint 表
  自动派生碰撞盒（房屋/遗迹/栈桥/岸礁/独木舟…，以及巨冠乔木/椰子树/竹丛/倒木的树干、竹竿、倒木本体），
  并自动叠加 `terrain.boundary` 的环礁岩脊碰撞环（含码头缺口）。改摆放 = 碰撞自动跟着变，不会出现"碰撞和视觉不一致"。
- 放置元素统一 `{x, z, ry, s}`；`layout.island.<数组名>` 是最终运行时结构，25 个岛图模型各自
  `buildWorld()` 读自己的数组（缺失/空数组 = 不生成）。
- 植被分级：**实体植被**（`jungleTrees` / `coconutPalms` / `bambooClumps` / `fallenLogs`）产生树干级碰撞盒
  （盒只包树干/竹竿/倒木本体，不包树冠）；**软植被**（`bushes` / `bananaPlants` / `fernClumps` /
  `grassTufts` / `vineDrapes`）是叶卡，仍可穿过（避免空气墙与割裂寻路）。`world-check` 会断言这条边界。
- 构建链不同：`createWorld()` 检测 `ctx.data.style === 'island'` 后走
  `island-terrain.js → island-props.js → island-water.js → island-ambience.js`，不建前哨建筑/贴花/沙尘。
- **环境音按 `style` 自动切换**：`world.style` 导出后由 `src/main.js` 调 `audio.setWorldStyle()`；
  `island` 用海洋/碎浪/树叶/鸟鸣音床，`outpost` 保持沙漠风床（实现见 `src/audio.js` 与
  `ISLAND_MAP_SPEC.md §11`）。新增 map@2 地图无需改音频代码。
- 检查工具：`node scripts/world-check.mjs`（同 map@1）+ `node .scratch/island-map/check-layout.mjs`
  （摆放数量/重叠/出界/堵门/ASCII 俯视图）+ `node .scratch/island-map/probe.mjs`（固定机位截图 + 单帧渲染统计）。

## 如何新增一张地图

1. 复制 `outpost-07/` 为 `src/config/maps/<new-id>/`。
2. 改 `map.json`：`id` 改成 `<new-id>`（**必须与文件夹名一致**），再改 `name` / `subtitle` /
   `description` / `bounds` / `playerSpawn`；按需要改各部件 JSON。
3. 在 `src/config/maps/index.js` 顶部为该地图每个部件加静态 import（带
   `with { type: 'json' }`），并在 `MAP_SOURCES` 里加一个条目：
   ```js
   import demoMap from './<new-id>/map.json' with { type: 'json' };
   // ...其它部件同理
   export const MAP_SOURCES = Object.freeze({
     'outpost-07': Object.freeze({ manifest: outpostMap, parts: { /* ... */ } }),
     '<new-id>': Object.freeze({
       manifest: demoMap,
       parts: { terrain: demoTerrain, environment: demoEnvironment,
                architecture: demoArchitecture, props: demoProps,
                dressing: demoDressing, spawns: demoSpawns },
     }),
   });
   ```
4. 需要默认切到新图就改 `DEFAULT_MAP_ID`；否则用 `?map=<new-id>` 进入。
5. 在 Node 里跑一次冒烟（无需浏览器）：
   ```bash
   node -e "import('./src/world/data/index.js').then(({loadMap})=>console.log(loadMap('<new-id>').warnings))"
   ```
   或直接用 `validateMapData(loadMap('<new-id>'))` 看 `errors`。

> 注意：碰撞体、敌人出生点、地标都不在 JSON 里手写——它们由 `layout` + `spawns` 推导。
> 新增/移动建筑时改 `architecture.json` / `props.json`，碰撞会跟着变。

## 数据层 API（`src/world/data/index.js`）

```js
import { loadMap, listMaps, DEFAULT_MAP_ID, MAP_FORMAT, validateMapData } from './data/index.js';

const data = loadMap('outpost-07');   // 规范化数据（纯数据，可 structuredClone）
const maps = listMaps();             // [{ id, name, subtitle, description, format, parts }]
const { ok, errors } = validateMapData(data);
```

`loadMap(id)` 输出（`ctx.data`）：

```
id, name, subtitle, description, format,
collisionBoxes: [{minX,maxX,minZ,maxZ,minY,maxY,surface}],   // 顺序与旧代码一致
playerSpawn: {x,y,z,yaw},
enemySpawns: [{x,y,z,label}],                                // 顺序 = 解析后的候选顺序
mapBounds: {minX,maxX,minZ,maxZ},
landmarks: [{x,z,name}],
warnings: [string],
layout: { walls, boundary, towers, buildings, blocks, lowWalls, pillars, tunnelPiers,
          arches, tunnelArches, crates, barrels, sandbagRuns, palms, lampPosts,
          gatePiers, stalls, hero, siteArches, looseCrates, tireStacks, sackPiles },
terrain, environment, dressing                                // 构建器直接消费
```

约束：

- 数据层**不得 import three / DOM**，输出必须是纯数据（无函数、无 THREE 对象），
  因为 `model-stage.js` 会 `structuredClone(ctx.data)`；`validateMapData()` 会拒绝非常规对象。
- `layout` 的元素形状与旧 `buildWorldData()` 完全一致（模型构建器 `src/models/world/*` 直接读它）；
  `barrels.yaw`、`palms.ry` 由适配器按旧公式推导。
- 未注册的 `?map=<id>` 会抛错（错误信息带可用 id 列表）并回落到默认地图。

## 校验与自检

- 运行期：`loadMap()` 会做 manifest / format / 纯数据 / `validateMapData()` 校验，失败即抛错。
- 一键校验所有已注册地图：`npm run check:maps`（等价于 `node scripts/world-check.mjs`），完整静态检查入口是
  `node scripts/check.mjs`。
- 视觉 / 数据 before-after：`node scripts/world-verify.mjs --tag=after` 再
  `node scripts/world-verify.mjs --compare=before,after`（固定相机截图 + 世界数据逐元素比较，输出在
  `.scratch/maps-refactor/verify/`，该目录 gitignored）。
- 本次重构的等价性证据（旧 `buildWorldData()` 基线 JSON、`check-parity.mjs` 一次性对比脚本）留在
  本机 `.scratch/maps-refactor/`（未入库，仅开发用）；入库的回归手段是上面的 `check.mjs` /
  `check:maps` / `world-verify`。

## 已知限制 / Roadmap

- `architecture.json` 的 `arches` 与 `siteArches` 有重叠（旧代码里 site arches 会同时出现在两处），
  改动其中一个要同步另一个，否则会重复或缺失门框；后续格式版本可合并。
- map@1（`outpost-07`）仍有少数“站点级”装饰由模型构建器代码按 outpost-07 的绝对坐标生成
  （boundary 的垛口/旗帜、B 隧道顶棚/灯/牌、pipeline、looseProps 木料/废料堆、siteBanners）。
  新地图只要把门楼/柱廊/方尖碑等对齐到这些硬编码坐标（`test-range` 的做法），或把这些坐标移到
  `dressing.json`，即可避免穿帮。**map@2（`island-01`）已彻底走独立构建链**，不再有这类硬编码。
- `test-range` 是格式示例/模板地图，不是正式关卡；默认地图仍是 `outpost-07`。
- 海岛地图（map@2）的碰撞由 footprint 表自动派生：结构/复用道具看 `FOOTPRINTS`，实体植被看
  `VEGETATION_FOOTPRINTS`（只包树干/竹竿/倒木本体，不包树冠）。如果新模型加入岛图，需要在对应表里补一条；
  叶卡类模型（灌木/芭蕉/蕨/草/藤）继续标记为无碰撞，`world-check` 的 island 植被断言会检查这条边界。

