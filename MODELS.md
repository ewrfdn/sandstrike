# MODELS // 模型目录

SANDSTRIKE 的所有可预览模型都按 **一个模型一个文件** 放在 `src/models/` 下，
由共享几何工具、模型注册表和两个 dev-only 预览入口组成。

```
src/models/
  core.js                共享工具：几何 UV/合并、matrix 辅助、batch、招牌/门窗/拱门、
                         instancing、布面材质注册、decal 合并、TAU/DEG
  index.js               MODEL_CATALOG：world + robot + weapon + loot 的统一目录（视图/HUD 用）
  world/
    index.js             WORLD_MODELS 桶文件（metadata + build）
    crate.js … sacks.js  7 个 instanced 杂物族
    well.js truck.js …   18 个场景道具 / 建筑 / 布面 / 灯具
    rpg-launcher.js      RPG-7 火箭筒（设计稿，不进入关卡；武器/手臂已拆分，见下）
    boundary.js          map 边界墙（非预览）
    mid-wall.js          中门墙（mid-gate 预览复用）
  robots/
    shared.js            RigBuilder、材质/调色、通用骨架部件
    scout.js rifleman.js heavy.js warlord.js boss.js   每个底盘一个文件
    preview.js           createRobotPreview（舞台预览姿态）
    index.js             ROBOT_TYPES / TYPE_KEYS / buildRobotRig / 预览入口
  weapons/
    hands.js             通用第一人称手臂模型（双手 + 前臂），持握 mount 可配置
    artkit.js            3 把新武器的共享程序化美术工具包（金属/聚合物/木纹/帆布/警示贴图、
                         枪口火焰 rig、手套材质、挤出/车削等图元）
    vxr7.js              VXR-7 武器模型 + 手臂配置 + 视模组合（weapons.js 只保留射击/动画逻辑）
    rpg7.js              RPG-7 火箭筒武器模型（锥形战斗部 + 尾翼 + 光学/机械瞄）
    gatling.js           M-77 六管加特林（rotating `barrels` 组 + 弹箱/供弹槽）
    shotgun.js           SG-12 泵动霰弹枪（`pump` 护木 + 管状弹仓 + 木托）
    index.js             WEAPON_TYPES / WEAPON_MODELS / createWeaponPickup（掉落物入口）
    preview.js           createWeaponPreview（舞台 BARE/HELD 预览，不依赖 WeaponSystem）
  loot/
    shared.js            掉落物共享材质（body / brass / batteryShell …，art pass 后集中定义）+ 预览单例
    ammo.js health.js    8 个掉落道具（弹药/维修/弹匣/威力/换弹/圣物/护盾/生命核心），
      mag.js power.js    一个种类一个文件：meta + createGeometries + buildItem + build
      reload.js relic.js
      guard.js vital.js
    index.js             LOOT_MODELS / LOOT_KIND_MODULES / createLootGeometries（EnemyManager 用）
```

## 模型文件约定（world）

每个 `src/models/world/<id>.js` 导出：

```js
export const meta = { id, kind: 'world', group, label };
export function build(ctx) { /* 预览：套用 stage 布局 + 预览脚手架，再调用 buildWorld */ }
export function buildWorld(ctx) { /* 地图装配：按 ctx.data.layout 生成全部实例 */ }
```

- 允许从 `../core.js`、`../../utils.js` 导入共享工具；不得从 `src/world/` / `model-stage.js` 反向导入。
- 布面模型（banner/flag/awning）额外导出 `createBanner/createFlag/createAwning`，供
  `src/world/dressing.js` 的 `buildCloths`（共用 `makeRNG(1717)`）按固定顺序调用。
- 预览专用脚手架（临时支撑、背板等）只写在 `build()` 里并注明 `// preview-only scaffolding`。
- `build(ctx)` 可以返回 `{ poseGroups }`：带 pose 的道具（如 RPG）把「只在某个姿态下出现」
  的子组（手臂）挂到 `ctx.scene`，由 stage/查看器按 pose 切换可见性；`bare` = 全部隐藏。

## 武器 / 手臂拆分（weapon-split）

**武器模型和手臂模型是两个独立模型**：只有在「持有（equipped）」时，武器模型才被绑定到
手臂所在的持握装配里。模型查看器里武器默认显示 **BARE（裸武器）**，切 HELD 才出现手臂；
未来武器掉落物在世界里就是 BARE 模型。

```
持握装配 held rig
gunRoot                          系统定位（WeaponSystem._setHipTransform）
└─ gun                           held frame：scale = heldScale（VXR-7 为 0.62）
   ├─ weaponRoot                 裸武器模型（无手套/袖口/前臂）
   └─ handsRoot                  手臂模型（双手 + forearms，无武器）— equip() 时一起绑定
```

### VXR-7（`src/models/weapons/`）

```js
meta = { id: 'weapon-vxr7', weaponId: 'vxr7', kind: 'weapon', group: 'weapon',
         poses: ['bare', 'held'], defaultPose: 'bare', lift: true }

createVxr7Materials()                       // 武器 + 手套全部材质/程序化贴图（构建一次复用）
buildVxr7Weapon({ mats, muzzleLight })      // 裸武器：receiver/optic/mag/枪口火焰 rig
buildVxr7Hands({ mats })                    // 双手 + 前臂；几何来自通用 hands.js
buildVxr7Viewmodel({ scene, muzzleLight })  // 兼容组合：gunRoot > gun(0.62) > { weaponRoot, handsRoot }
```

- `buildVxr7Weapon()` 的 mesh 坐标 = held frame 坐标（未乘 0.62），可以单独放进世界；
  `createWeaponPickup('vxr7')` 会给它套上 `heldScale`，作为掉落物/检视模型。
- `buildVxr7Viewmodel()` 仍返回旧的扁平 handle（`gunRoot, gun, bolt, charging, magazine,
  spareMagazine, trigger, reticle, sightLocal, flashGroup, flashMats, muzzleLocal,
  muzzleLight, smokePuffs, matSteel …`）+ 新增 `weaponRoot` / `handsRoot`，
  `WeaponSystem` 的动画/后坐力/换弹代码无需改动。
- `hands.js` 的 `buildGlovedHands({ mats, right, left })` 是通用手臂模型：右手握把手型、
  左手 C-clamp 支撑手，mount（position/rotation）与前臂 sleeve run（points/rWrist/rElbow）
  由参数传入。给未来新武器复用时，只需要提供该武器的持握坐标。
- 裸武器几何（2026-11 重做）：机匣/下机匣/握把/弹匣/枪托用侧轮廓挤出（`PROF` / `PROF_HOLE`），
  护木为八边形截面 + M-LOK 凹槽，全长导轨压在机匣和护木桥接条上（不再悬空），
  扳机护圈是带扳机窗口的实心护板；所有可见网格在装配后必须彼此接触
  （连通性检查：183 个可见网格 = 1 个连通体，0 个悬空部件）。
- 光学瞄具（全息）是**中空框架**：底部机匣、顶盖、左右侧壁 + 前后环形镜框，
  前后窗口都敞开；镜片用透明材质（`opacity 0.07`、`depthWrite: false`、双面、无 transmission），
  准星/环形/刻度 `renderOrder = 4` 保证透过镜片仍可见。ADS 时从镜内能看到场景与准星，
  准星位置 `sightLocal = (0, 0.214, 0.045)` 未改（ADS 归零仍打在屏幕中心）。
- 动画锚点保持不变：`magazine` 组位于 (0, -0.096, 0.035)/rot(-0.12)、`charging` 组 z=0.145、
  `bolt` 位于 (0.055, 0.062, -0.005)、`trigger` 以自身轴心旋转、`reticle/sightLocal` 位置不动。

### 注册表 / 未来武器捡拾（`src/models/weapons/index.js`）

```js
WEAPON_TYPES.vxr7 | rpg | gatling | shotgun
                    // { id, catalogId, label, heldScale, meta, createMaterials,
                    //   buildWeapon, buildHands }（vxr7 另有兼容 buildHeldRig）
WEAPON_MODELS       // 4 个武器 meta（模型查看器 catalog 条目，models/index.js 展开）
getWeaponType(id)   // 接受 'vxr7' / 'weapon-vxr7' 等，未知抛错
createWeaponPickup(typeId, { scale })  // 世界里的裸武器实例 { root, weaponRoot, dispose }
```

捡拾流程（多武器重构后已接入玩法）：

1. 掉落在世界：`const item = createWeaponPickup('gatling'); scene.add(item.root);`
   （`item.root` 已乘 `heldScale`；掉落姿态由调用方给 root 施加旋转，例如平放在地面）。
2. 玩家拾取：`WeaponSystem.addWeapon(type)` + `equip()` 按 `WEAPON_TYPES` 重建持握装配
   （`gunRoot > gun(heldScale) > { weaponRoot, handsRoot }`，每把武器只构建一次）。
3. 丢弃/切换：切枪只 toggle visible 并重设 `muzzleLight`/准星；`unequip()` 返回
   `{ weaponRoot, handsRoot }` 供丢弃复用。
4. `equip()/unequip()` 是 `src/weapons.js` 里唯一的绑定/解绑点；暂停/菜单/死亡
   （`setActive(false)`）不算卸下武器。

### RPG-7 / M-77 加特林 / SG-12 泵动霰弹枪（多武器重构，已接入玩法）

武器掉落系统上线后，4 把武器全部是 **functional** 的武器模块（不再有 design-only 武器）：
玩家默认 VXR-7，RPG / 加特林 / 霰弹枪由 Boss 掉落、`WeaponSystem` 拾取后按同一套
held rig 装配。三把新武器与 `vxr7.js` **同构**，都导出 CONTRACT §5 的
`meta / createMaterials / buildWeapon({ mats, muzzleLight }) / buildHands({ mats })`：

| 模块 | catalog id | heldScale | muzzleLocal (held frame) | 专属 handle | 说明 |
|---|---|---|---|---|---|
| `weapons/rpg7.js` | `weapon-rpg` | 0.62 | `(0, 0.02, -0.60)` | `rocket` | 发射筒/文丘里尾喷口/木质隔热护板/前握把/机械+反射瞄、已装填 PG-7V（锥形战斗部+尾翼） |
| `weapons/gatling.js` | `weapon-gatling` | 0.60 | `(0, 0, -1.02)` | `barrels`（`rotation.z` 自转） | 6 管枪管簇 + 前轴承环 + 机匣 + 提把 + 弹箱/供弹槽（`magazine`/`spareMagazine`） |
| `weapons/shotgun.js` | `weapon-shotgun` | 0.62 | `(0, 0, -0.92)` | `pump`（`position.z` 泵动） | 机匣 + 枪管/通风肋 + 管状弹仓 + 木质泵动护木/枪托 + 侧挂弹壳 + 鬼环/珠形准星 |

- 通用材质命名：`matSteel / matSteelDark / matBlack / matPolymer / matRubber / matAccent /
  matBrass / matGlass` + 各武器专属（`matTube`、`matWarhead`、`matWood`、`matCanvas`、
  `matHazard`、`matShell`、`matGlow` …）+ 手部 `matGlove / matGlovePalm / matGloveDark /
  matSleeve`（`artkit.js` 的 `createGloveMaterials()`，每把武器不同手套色调）。
- 三把新武器的坐标同样 = held frame（未乘 heldScale）；`createWeaponPickup()` 直接可用。
- `flashGroup / flashMats / muzzleLocal` 由 `artkit.js createFlashRig()` 统一生成
  （Sprite + 核心 Sprite + 前向锥体，additive/transparent/depthWrite:false，初始 opacity 0），
  `muzzleLight` 会 re-parent 到 `flashGroup` 下；WeaponSystem 的枪口火光/灯光代码无需区分武器。
- 加特林的 `barrels` 组中心 = 枪膛轴 (0,0)，6 根枪管严格平行且同心，`barrels.rotation.z`
  即 WeaponSystem 的转速；霰弹枪的 `pump` 组挂在 root 原点，`pump.position.z` 即泵动位移；
  RPG 的 `rocket` 组 = 已装填火箭（开火隐藏、换弹完成后再显示）。
- `reticle`：RPG / 加特林有小型反射瞄（`sightLocal` = 瞄窗中心），霰弹枪为机械鬼环
  （`reticle:null`，`sightLocal` = 鬼环中心）；其余 handle 为 null（`magazine/bolt/...`，
  WeaponSystem 全部 null-safe）。
- 质量预算（BARE，model-shots `index.json` 口径）：RPG ≈ 9.4k tris / 114 meshes，
  加特林 ≈ 16.2k tris / 207 meshes，霰弹枪 ≈ 9.1k tris / 121 meshes（HELD 含手臂约 +9.4k/94）。
  三把武器的可见网格连通性 = 1 个连通体（无悬空部件）。

### RPG-7 设计稿（`src/models/world/rpg-launcher.js`，仍不进入关卡）

设计稿保持原样，**不是**玩法掉落模型；玩家手里的 RPG 是上文的 `weapons/rpg7.js`。
设计稿同样按「武器 / 手臂」拆分并接入查看器：

- `buildLauncher(ctx)`：纯火箭筒几何（坐标逐字保留）；`buildHeldHands(ctx)`：原来的
  手套/袖管，独立 Group（不进 StaticBatcher，因此可以单独隐藏），默认 `visible = false`。
- `build(ctx)` → `{ poseGroups: { bare: null, held: handsGroup } }`；`buildWorld(ctx)` 只建裸武器。
- meta 带 `poses: ['bare', 'held']`、`defaultPose: 'bare'`；HELD 的 triangles/verts/包围盒
  与拆分前完全一致，`meshes` 因手臂从合批改为独立 mesh 而变多（预期差异）。

### 掉落道具 / LOOT（`src/models/loot/`）

游戏里机器人掉落的 8 种拾取物也按「一个种类一个文件」纳入本目录，并直接进入模型查看器
（分组 `loot`，catalog id `loot-<kind>`）：`ammo`（弹药储备）、`health`（装甲修复）、
`mag`（弹匣扩容）、`power`（子弹威力）、`reload`（换弹加速）、`relic`（金色圣物）、
`guard`（护盾模块）、`vital`（生命核心）。

```js
meta = { id: 'loot-<kind>', kind: 'world', group: 'loot', label, lift: true }
createGeometries()                  // 该种道具的几何
buildItem(parent, { geos, mats })   // 把该种道具的 mesh 加到 parent，返回 mesh 数组
build(ctx)                          // 舞台预览：独立几何 + shared 材质单例
```

- 单一来源：`src/enemies.js` 的 `_initPickups()` 调用
  `createLootGeometries()` / `createLootMaterials()`（`EnemyManager` 拥有并在 `dispose()`
  释放），`_createPickupItem()` 对每个 kind 调 `buildItem()`；掉落表、池化、拾取判定、
  buff 数值仍全部留在 `enemies.js`，模型文件不含玩法逻辑。
- `shared.js` 集中定义所有掉落物材质（body / magMetal / brass / batteryShell 等）；
  `getLootMaterials()` 供舞台预览复用单例。
- 造型（2026-11 art pass）：`ammo` = 黄铜弹板 + 一排立起的子弹；`health` = 蓝色电池
  （金属端盖 / 正极凸台 / 蓝色充能环 / 两面「+」）；`mag` = 弯曲弹匣（挤出曲线轮廓 +
  发光弹匣带 + 顶部露出的两发黄铜子弹）；`guard` = 盾牌（盾形挤出板 + 背光轮廓 +
  能量核心 + 光环）；`power` / `reload` / `relic` / `vital` 保持原有造型。
- `meta.lift = true`：舞台把道具「落」在平台上（不像游戏里悬浮/自旋）；无姿态，
  POSE 行显示禁用占位。造型是纯观感改动，拾取判定/半径/生命周期均由 `enemies.js` 决定。

## 热带孤岛资产（ISLAND ASSETS）

新地图（四面环水的封闭热带小岛：茂盛雨林 + 草村 + 失落石造遗迹，清晨低角度金光）的模型与
纹理已独立成组，完整规划 / 面数预算 / 材质与纹理契约 / 下一步地图 layout 字段见
**`ISLAND_ASSETS.md`**。

- **模型**：`src/models/world/island/`，每个模型一个文件（约定与其他 world 模型相同：
  `meta` / `build(ctx)` / `buildWorld(ctx)`）。5 个族桶
  （`flora-canopy.js` / `flora-understory.js` / `village.js` / `ruins.js` / `shore.js`）
  由 `island/index.js` 汇总后追加到 `WORLD_MODELS`，模型查看器新增
  **FLORA / VILLAGE / RUIN / SHORE** 四个分组。全部模型 `buildWorld()` 从
  `ctx.data.layout.island.<key>` 读实例数据，字段缺失时静默跳过，因此地图接好前
  对 `outpost-07` 零影响。
- **纹理**：`src/textures/island-flora.js`（`lib.jungleGrass` / `leafLitter` /
  `broadleaf` / `tropicalFrond` / `beachSand`）与 `src/textures/island-structure.js`
  （`lib.thatch` / `tropicalBark` / `bamboo` / `mossStone` / `woven`），仍是运行时
  Canvas2D 程序化生成，零外部资源。
- **叶片卡**：统一采样 `src/textures/broadleaf.js` 的 1024² 2×2 alpha 图集
  （broad / banana / fern / vine），UV 契约在
  `src/models/world/island/leaf-atlas.js`（内部已处理 CanvasTexture `flipY`，
  模型侧只用 `leafQuad()` / `leafCellUV()`，不要手写格子 UV）。
- **材质**：`src/world/materials.js` 新增 `M.jungleGrass / leafLitter / broadleaf /
  broadleafDark / frondLush / thatch / thatchDark / barkTrop / barkMoss / bamboo /
  mossStone / ruinStone / shoreRock / beachSand / woven / rope / driftWood / mud`；
  批次键在 `src/world/architecture.js` 的 `ensureBatches()` 注册。

## 预览方式（仅 dev 模式）

| 用途 | 入口 |
|---|---|
| **模型浏览器 WebUI（推荐）** | `http://127.0.0.1:8080/models.html?dev` |
| 单独舞台/自动化 | `http://127.0.0.1:8080/stage.html?m=<id>&view=front&pose=held` |
| 游戏内 dev 入口 | `index.html?dev` 右下角 `模型预览 MODEL VIEWER` 按钮 |

- `models.html` 无 `?dev` 时显示 `DEV ONLY` 门禁，不加载渲染器。
- WebUI 左侧按组（杂物/主道具/掉落物/建筑/布面/机器人/武器）列出全部模型，支持搜索、
  ↑/↓ 或 ←/→ 切换、1-5 切视角、P 切姿态，也可 `?m=<id>` 直达。
- **姿态 POSE**：机器人 `BASE / AIM / WALK`；武器与带 pose 的设计稿 `BARE / HELD`。
  在 WebUI 里点按钮或按 `P` 切换；`stage.html` / 自动化可用 `?pose=bare|held` 直接指定。
  无姿态的模型 POSE 按钮为禁用占位。
- **自由旋转**：在预览画面中拖动可 360° 环绕查看模型（上下拖动改俯仰角），
  滚轮/触控缩放；双击画面或点 `RESET` 回到预置视角。信息栏实时显示
  `AZ / EL / ZOOM`，自由旋转时显示 `CUSTOM ORBIT`。
- 武器预览不再构造 `WeaponSystem`：`kind:'weapon'` 走 `createWeaponPreview()`，
  默认 BARE 因此不会出现「只有两条断臂」的画面。
- 修复/迭代时建议先用 WebUI 目测（可任意角度查看），再用自动化批量出图。

## 自动化 QA

```bash
# 全模型 48 张 4 视图 contact sheet → shots/models/<id>.jpg + index.json
node scripts/model-shots.mjs --quality=high

# 单个模型 / 指定视角 / 指定姿态（武器支持 bare|held，掉落物支持 loot-<kind>）
node scripts/model-shots.mjs --only=well,truck
node scripts/model-shots.mjs --only=loot-ammo,loot-relic
node scripts/model-shots.mjs --only=weapon-vxr7,weapon-rpg,weapon-gatling,weapon-shotgun
node scripts/model-shots.mjs "--single=weapon-vxr7,side,held,1.2,.scratch/weapon-hold.jpg"
```

- 有 `poses` 的模型（4 把武器 / RPG 设计稿）默认 sheet 为
  `3/4 BARE · SIDE BARE · 3/4 HELD · FRONT HELD`，同一张图即可对比手臂是否绑定。
- `index.json` 里的 `stats` 记录的是**默认姿态**（武器为 BARE）；HELD 的回归数字
  （VXR-7：triangles 20,890 / meshes 212 / verts 43,120 / materials 21 / size
  0.375×0.507×1.142；RPG：1,360 / 4,080 / 8 / 0.455×1.047×2.514）由
  `.scratch/weapon-split/verify/` 下的验证脚本用 `setPose('held')` 采集。
- 回归要求：修改模型后 `node scripts/check.mjs`、`node scripts/qa.mjs`（errors=[]）、
  `node scripts/map-audit.mjs`（空气墙/悬浮/不可达 0）必须保持通过；渲染结果应与
  修改前 baseline 像素一致（除有意改动）。武器拆分额外要求 HELD 统计与拆分前相等，
  游戏内视模的 mesh 世界矩阵（按 `gunRoot` 归一化后）除枪口 flash 随机旋转外完全一致。
