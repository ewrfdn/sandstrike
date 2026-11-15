# ISLAND MAP // 热带孤岛关卡设计 & 施工契约

> 目标：`island-01` = **ATOLL-09 / 碧潮环礁·第九区**。
> 四面环水的封闭热带小岛，清晨湿润雨林 + 茅草村落 + 零散遗迹，15 波敌人、每 5 波 Boss。
> 规模：**可玩陆地面积约为沙漠图 2 倍**（沙漠 66×66 = 4,356 m²；本图边界圆 r=52 → π·52² ≈ 8,494 m² = 1.95×），
> 总地图 140×140 m（含环礁水域），`mapBounds = ±70`。
>
> 本文是**施工契约**：数据格式、坐标分区、碰撞派生、验收命令、写作用域。改契约先改本文。

---

## 1. 世界坐标与总体分区

- 米制，+Y 上，**北 = -Z，南 = +Z，东 = +X，西 = -X**。草地盘顶面 y=0。
- 岛不是一个圆，而是一条**被半径 warp 打乱的闭合海岸线**（`island-shore.js` 的 3 次谐波 warp，幅度 ±2.44 m）：
  沙滩从草地外缘（`beachInner` 41）一路下坡到水线（`waterline` ≈ 53.5）再没入水下，海底坡到 `bedOuter` 96 接深海。
- **没有环礁岩脊了（2026-11-15 重构）**：旧版 r≈52 的礁石闭合环 + 116 个隐形碰撞盒已整体删除，海岸线完全打开，
  玩家可以走下沙滩、踩着湿沙走进浅水（膝盖深）。
- **可玩边界改为水中夹紧**：`island-shore.js` 的 `guardRadius`（水线外 ≈3.9 m，即 0.62–0.68 m 水深）做精确半径夹紧，
  每个方位的夹紧点都落在**同一水深**上，并保留切向速度（贴着岸滑行，不会"撞墙"）。敌人共用同一夹紧。
- 玩家 y 不再恒 0：`world.groundHeight(x,z)` 给出沙面/海底高度，玩家、机器人都贴地；木栈桥/村道高台仍是"可踩碰撞盒"（顶面 ≤0.30 m）。
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
  terrain.json      # 岛形/沙滩/海底/水体参数（岩脊已删）
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
  "island": { "grassRadius": 44, "beachInner": 41, "landRadius": 57, "seed": 7712, "segments": 168 },
  "sea": { "level": -0.38, "bedOuter": 96, "bedDrop": -7.5,
           "shallow": [0.10, 0.34, 0.32], "deep": [0.02, 0.09, 0.13], "distance": 420 },
  "colors": { "grass": [0.42, 0.62, 0.36], "sand": [0.92, 0.84, 0.66], "seabed": [0.72, 0.68, 0.52] }
}
```

没有 `boundary` 块了。`landRadius` 只是"沙滩名义外缘"，真正的干湿分界/水线/夹紧半径都由
`island-shore.js` 从 `island` + `sea` 参数烘焙（见 §4.5），改这两个块就能整体缩放海岸。`sea.shallow/deep`
只剩历史意义（水体颜色现在由 `ocean/glsl.js` 的 absorption/scatter 决定）。

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

- ~~边界岩脊~~：**已删除**（2026-11-15）。海岸线没有碰撞盒，靠 `island-shore.js` 的半径夹紧挡住出界；
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

> 判定标准：`map-audit` 每个 >0.5 m 的盒必须有贴合可见几何。
> 植被盒只包树干/竹竿/倒木本体，**不包树冠/叶卡**：一是避免"空气墙"，二是叶卡植被
> 本来就设计成可穿过。软植被（灌木/芭蕉/蕨/草/藤）不产生碰撞盒，由 `world-check`
> 的 island 植被断言守住这条边界。

---

## 4. 视觉模块契约

### 4.1 `src/world/island-terrain.js`

```js
export function buildIslandTerrain(ctx) // 返回 { ground }
```

- 所有沙面（草地落叶盘除外）都**采样同一份海岸剖面** `shoreProfile(terrain)`（见 §4.5），不允许再出现"各自算一遍"：
  沙滩环 × 海底坡在 `waterlineAt(bearing) + 2.2` 的接缝上**共用边界顶点**（几何水密、无 z-fight、无颜色断带）；
- 沙滩环（`beachInner` → 接缝）：`name='island-beach'`，`beachSand` 材质，顶点色按**高度相对海平面**混合
  干沙 / 潮湿沙 / 湿沙 / 水下浅沙（不再按半径混）；外侧轮廓由 warp 半径决定，因此水线是自然曲线而不是圆；
- 海底坡（接缝 → `bedOuter`）：`name='island-lagoon'`（沙底 + 水下沙纹）、`island-coral`（珊瑚/海草簇）、
  `island-scatter`（贝壳/碎石/漂浮物）、`island-tideline`（海藻带）；
- **水下材质调色必须保持"浅色沙"**：水是真正透明的（§4.2），颜色由水体 absorption/in-scatter 提供；
  海底自己刷深蓝/墨绿会合成一条浑浊暗带（旧版 opaque 水面时期的画法，已废弃）；
- 以上 6 个 mesh 都打 `mesh.userData.seabed = true`——海面折射用的俯视 seabed capture 只白名单这些 mesh；
- 无石质边界岩脊（旧 `buildReefRidge` 及 `islandRingBoxes` 已删除）；
- `ctx.ground` 必须指向草地 mesh（map-audit / 子弹依赖 `name='ground'`）；
- 额外导出给世界层：`ctx.shoreProfile`、`ctx.groundHeight(x,z)`、`ctx.shoreGuard = { guardRadiusAt }`；
- 静态几何，无每帧开销；`ctx.terrainTris` 约 30k（旧版含岩脊 57.6k）。

### 4.2 `src/world/island-water.js`（2026-11-15 重写）

```js
export function buildIslandWater(ctx) // 返回 { mesh, foam, level, update(time) }
```

实现拆到 `src/world/ocean/`：`quality.js`（分档预算）、`glsl.js`（波浪/天空/海底/焦散 GLSL）、
`seabed-capture.js`（一次性俯视海底烘培）、`water.js`（海面）、`surf.js`（浪花带 + 湿沙带）。

- **海面**：以水线为中心的放射状网格（近岸 0.7–1.2 m 间距、向 470 m 视界渐疏），顶点用
  `oceanSurface(xz, t)` 真实位移（涌浪 + 碎浪共 21/13/11.4/7.5 m 等波列），法线由同函数梯度解析求出；
- **折射**：`refract(入射, 法线, 1/1.33)` 后在解析海底面步进，采样 `uSeabed`（seabed capture 的**线性 HDR** 纹理，
  正交俯视，1024²@medium / 2048²@high+，范围 ±130 m）；海底 albedo 从 capture 亮度重建为浅色沙 + 结构；
- **水体颜色**：Beer-Lambert（absorption ≈ (1.00, 0.22, 0.16)/m）+ in-scatter（浅水 (0.048,0.275,0.36) → 深水 (0.007,0.042,0.11)），
  水面 alpha 随水深从 0.70 升到 1.0，**干沙上直接 discard**（只保留极薄的一层 swash 水膜），所以浅滩是清澈透底的绿松石；
- **波浪可见**：菲涅尔天空反射 + 太阳高光长条（HDR，给 bloom 用）+ 焦散（在水下沙面上，随深度/视角衰减）；
- **浪花带**：`surf.js` 生成一条**贴着位移后水线**的窄带（水线 −2.6 m … +8 m），泡沫用解析三角函数交叉场打散
  （不再用 hash 值噪声格子），alpha 上限 0.86/0.16/0.18，无 discard 硬边；
- **湿沙带**：swash 记忆（采样 t、t−1.6、t−3.4 的波高）给出干湿过渡，水覆盖后淡出；
- 分档：lowest 无 capture（程序化海底）13.7k tri / low 512² 22.8k / medium 1024² 41.5k / high 2048² 70.7k / ultra 2048² 108.8k，
  稳态 **3 个 draw call**，海面 `frustumCulled=false`、`renderOrder=2`、`depthWrite=false`；
- 不参与 raycast/碰撞（`userData.surface` 不设）；构建失败时 try/catch 返回惰性 stub，绝不阻断世界生成。

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

### 4.5 `src/world/island-shore.js`（海岸线契约，唯一的真相源）

纯数学模块（**不 import three**，服务和 GLSL 都能用）：

```js
shoreProfile(terrain) -> {
  landRadius, level, dryTo, waterline, wadeRadius, guardRadius, bedOuter, bedDrop,
  guardRadiusAt(bearing), height(r), Y(x,z), depthAt(x,z), waterlineAt(bearing),
  warpRadius(bearing), lut, lutSize,   // 512 texel 单调三次插值 LUT
}
clampToGuard(profile, position, offset) // 精确半径夹紧（就地修改）
warpRadius(bearing)
SHORE_GLSL_UNIFORMS / SHORE_GLSL      // 供 ocean 着色器
```

- 一条**单调**径向高度剖面（干燥沙台 → 沙滩坡 → 水线 → 水下坡 → 深海），JS（地形/玩家/敌人）与 GLSL（水/浪花）
  读的是同一份 512 texel LUT，所以**几何与着色器不可能对不上**；
- 半径再用 3 次谐波 warp（±2.44 m）打乱，海岸线不是圆；
- 关键常量：`level −0.38`、水线 53.5、干沙结束 49.5、涉水上限 ≈57.44（水深 0.62）、夹紧半径 +0.35（水深 0.68）；
- `guardRadiusAt` 保证**每个方位夹紧点水深相同**，玩家/机器人在任何方位都是齐膝深停下。

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
| bushes | 42–52 | 林缘 + 村舍旁 + 沙滩内缘 |
| vineDrapes | 26–34 | 大树/遗迹/林缘 |
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
| 新格式适配器 | `src/world/data/formats/v2.js` | 归一化 island layout、按 §3 footprint 自动派生碰撞盒 + 实体植被树干碰撞（`VEGETATION_FOOTPRINTS`）、复用道具碰撞、"每盒来源 kind" 标签（**岩脊环已删除**） |
| 校验 | `src/world/data/index.js`（`validateIslandMapData`） | island 专属校验：地形/海面数值、25 个摆放数组、地标/出生点/半径（放置半径允许到 `guardRadius`，栈桥可探入水面） |
| 海岸线契约 | `src/world/island-shore.js` | 纯数学（无 three）：单调径向剖面 + 512 LUT + 3 谐波半径 warp + `clampToGuard` + 共用 GLSL（见 §4.5） |
| 岛形数学 | `src/world/island-shape.js` | 纯数据：仅剩 `landRadius(terrain)`（`island-water.js` 用它定 capture 范围）；`resolveBoundary`/`boundarySegments`/`islandRingBoxes` 已删除 |
| 地形 | `src/world/island-terrain.js` + `terrain.json` | 草地/落叶/沙滩（干→湿→水下连续调色）/贝壳碎石/海底坡/珊瑚/海藻带；全部采样 `shoreProfile`；30.1k tri（旧版含岩脊 57.6k）；5 个水下 mesh 打 `seabed` 标签 |
| 水面 | `src/world/island-water.js` + `src/world/ocean/` | 位移海面 / 折射 + Beer-Lambert / 焦散 / 浪花带 / 湿沙带；5 档画质，稳态 3 draw call（见 §4.2） |
| 氛围 | `src/world/island-ambience.js` | 花粉浮尘 / 薄雾带 / 海鸟（无碰撞不投影） |
| 装配 | `src/world/island-props.js` | 25 个岛图模型 + 复用道具（货箱/木桶/矮墙/摊位/篝火）按 layout 装配 |
| 构建分支 | `src/world/index.js` + `update.js` | `ctx.data.style === 'island'` 走海岛构建链（地形→摆放→水→氛围），含进度文案；水面/氛围按帧更新 |
| 波次 / 关卡 | `src/config/waves.js`、`stages.js` | `ISLAND_01_WAVES`（15 波，5/10/15 Boss）+ `STAGE_WAVES['island-01']`；关卡 02 ATOLL 09（默认解锁，`?stage=island-01` 直达） |
| 注册 | `src/config/maps/index.js` | `MAP_SOURCES['island-01']`，`DEFAULT_MAP_ID` 仍为 `outpost-07` |
| 工具 | `.scratch/island-map/` | `check-layout.mjs`（摆放体检+ASCII）、`probe.mjs`（12 机位）、`hero.mjs`（实机截图）、`qa/{tour,waves,perf}.mjs` |
| 文档 | `README.md`、`src/config/maps/README.md` | map@2 格式说明、地图清单、命令与已知限制 |

### 最终数据（v2 反馈迭代后）

- 地图：140×140 m（含水域），可玩环带 r≤52 ≈ **8,494 m² ≈ 1.95×** 沙漠图（66×66=4,356 m²）
- 碰撞盒 **356** 个（结构 78 + 复用掩体 59 + 实体植被 219；旧版另有 114 个环礁边界环盒，已随岩脊删除），22 个敌人出生点（全部 clear），9 个地标
- 海岸线（2026-11-15 重构）：水线 53.5±2.44 m 自然曲线、干沙结束 49.5、涉水夹紧 ≈57.8（水深 0.68 m，8/8 方位一致）；
  玩家与机器人都贴地（`world.groundHeight`），沙滩湿沙/水下沙/浪花/折射全部来自同一份剖面
- 摆放（v2 加密）：树 **63**（21 丛×3）· 椰树 20 · 芭蕉 24 · 蕨 34 · 竹 18 · 灌木 46 · 藤 30 · 倒木 11 · 草簇 200；掩体：石垒矮墙 10 · 货箱 17 · 木桶 16 · 摊位 3 · 篝火 1
- 神殿群：9 残墙 / 2 拱门 / 1 石塔 / 2 石像 / 16 石柱 / 东西侧室 / 中轴柱廊；遗迹模型加细节后 tri 7.6k/9k/16.6k/5.2k/4.2k（wall/arch/tower/idol/column）
- 天空/雾气：天顶蓝 [0.14,0.40,0.76]、地平雾 #a8bcc4 @0.0076、云层 `cloudOpacity 0.35`（更蓝的天空 + 大量湿雾散射）；5 条大尺度低空雾带 + 花粉 460 + 海鸟 6；环境光 0.4 / 半球光 1.28 提亮阴影
- 15 波 / 每 5 波 Boss（wave 5/10/15，Boss 替换 warlord），通关写 `cleared=true`
- 性能（720p）：draw calls **135–172**；probe `frameTris 2.85–3.20 M`（含阴影 pass，双画 caster）、**场景本体 1.60 M**；纹理 62 / 几何 98
- 质检：`world-check` / `check.mjs` / `check-layout` 全绿；map-audit 可玩环玩家可达 99.7%（2 处新增围合院角死区 P2）、0 浮空、0 bad floor、0 console error，空气墙 4 条均预期（栈桥护栏×2/晒架×2）；outpost-07 回归数据逐元素一致、截图差异仅动画相位

### 已知 P1 / P2（不阻塞发布）

- ~~**P1 视觉**：环礁岩脊的礁石偏"低模锥块"~~ —— 岩脊已整体移除（见 §10.1），该 P1 关闭。
- **P1 视觉（新）**：水下沙底的 seabed capture 在 1024²（0.25 m/texel、无 mip）下对比度偏低，40–90 m 处可能极轻微闪烁；需要时把 capture 范围从 ±130 m 收窄或加 mip 即可。
- **P2**：岛图 4 条 map-audit 空气墙均为预期障碍（栈桥护栏 ×2、晒架 ×1–2）；`robot` 可达率按全图统计 37–39%，但**可玩环 r≤52 内四象限 99–100% 可达**（环外海面/礁石计入不可达属正常口径；99.5% 少量死区来自新增矮墙/围合院角）；JETTY 地标在栈桥甲板上，机器人不上桥属设计取舍。
- **P2（植被碰撞权衡）**：实体植被碰撞落位后，审计的安全余量口径 `robot_r105_nav`（r=1.05 m）ring 97.5%→2.6%、22 个 spawn 不可达；同理 boss 半径 1.35 按 safety 口径复算 97.9%→1.6%。实际游戏只建 light 0.58 / heavy 0.72 两套 NavGrid（`src/enemies.js navFor()`），Boss 用 heavy 网格 + 独立 spawn 搜索（clearance 1.45），按真实底盘半径复算游戏内网格零回归（rifleman 99.5→99.4 / heavy 99.5→99.4 / warlord 97.3→96.2）。**未来若新增半径 >1.05 m 的底盘需重新评估 jungle 寻路**。
- **P2**：天空云层已通过 `cloudOpacity=0.35` 大幅压低，仅极低机位保留极淡云带；草纹理在近距离有斜向笔触感、树冠仍有卡片感。
- 修复记录：`barrel.js` 的 outpost 站点第二排木桶硬编码坐标会导致岛图 4 个木桶悬空（0.94m），已改为仅 outpost 生效；`v2` 篝火碰撞高度 0.55→0.45 消除矮障碍空气墙误报；`driftwood` footprint 3.4×1.5→2.2×0.65 贴合枯木；`jungle-tree`/`vine-drape` 的内联注释/标签乱码已修复。
- 修复记录（用户反馈"小岛树木等模型没有碰撞体积"）：`formats/v2.js` 新增 `VEGETATION_FOOTPRINTS`，为实体植被派生树干级碰撞盒（巨冠乔木 63、椰树 20×2 段、竹丛 18 丛×4 竹竿、倒木 11×4 段，共 **219** 盒；见 §3 表）；软植被（灌木/芭蕉/蕨/草/藤）保持可穿过。碰撞盒 251→470；`world-check` 追加 island 植被碰撞回归断言（实体植被必须有盒、软植被必须无盒、盒宽不得失控）。map-audit 复核：空气墙维持 4 条预期（0 新增 top-only）、玩家可玩环 r≤52 可达 99.7%（与改造前一致）、机器人 r=0.58 环 99.4%（-0.1%）、0 console error；r=1.05 安全余量变体因新增树干障碍从 97.5% 降至 2.6%（实际游戏只用 0.58/0.72 两套 NavGrid，见 §10 说明）。

---

## 10.1 海岸线重构（2026-11-15，用户反馈："海边石头墙移除 + 透明海水 + 沙滩可走"）

**用户需求**：移除围着海边的石墙；海水要能看透、有波浪、有正常折射；玩家能走到沙滩边缘踩水。整体优化场景。

**做法**：新增 `src/world/island-shore.js` 作为唯一海岸线真相源（单调径向剖面 + 512 texel LUT + 3 谐波 warp），
地形/玩家/敌人/水体/浪花全部读同一份剖面；删除礁石环（视觉 + 114 个碰撞盒）；改写海面为真实位移 + 折射 + Beer-Lambert 的
透明水体 + 浪花带 + 湿沙带；玩家/机器人改为贴地 + 水中半径夹紧。

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| 礁石环碰撞盒 | 116（r≈48.5–56.5 闭合） | **0** |
| 地形三角形 | 57,633（岩脊 28,204） | **30,101** |
| 碰撞盒总数 | 470 | **356** |
| 海面 | 4 verts / 2 tris 平坦色膜，无光照模型 | 41,472 tris（medium）位移海面 + 折射 + 焦散 + 浪花 + 湿沙，3 draw call |
| 海底可见度（俯视高反差棋盘注入） | — | `stripeVisibility 0.806`、`detailCorr 0.906` |
| 玩家走向水面 | 停在 r≈49.9–50.4（礁石环前），脚离地最多 0.30 m | 8/8 方位停在 `guardRadiusAt` 56.46–59.03 m，**水深恒 0.68 m**，脚误差 0.004 m |
| 沿海岸线行走 | 浮空 1.165 m（走不了） | 连续行走 12.18 m，脚误差 0.001 m |
| 波浪 | 法线假波 | 顶点真实位移（4 波列 + 碎浪），4 帧画面运动 0.88（阈值 0.25） |
| 画质分档 | 1 档 | 5 档（lowest 无 capture → ultra 2048² + 123.7k tri） |

**验证**：`node scripts/check.mjs` / `world-check`（3 图 0 warning）/ `scripts/shore-probe.mjs`（18/18 断言，
before / after / 5 档 / outpost-07 / test-range 全量回归）/ 目视（`shots/shore-before/` ↔ `shots/shore/`、`shots/shore-beauty/`）。
物体：玩家涉水减速 35%、敌人不会游泳（同夹紧）、栈桥桩基下沉到真实水线。

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





