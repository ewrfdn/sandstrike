# ISLAND ASSETS // 热带孤岛地图 · 模型与纹理资产规划

> 新地图目标：**四面环水的封闭热带小岛**——茂盛雨林、草村（茅草干栏屋）、零散破败的建筑残骸。
> 时间：**清晨 / 白天**，湿热、雾气、露水，低角度金色晨光穿过树冠形成光束与斑驳光影。
>
> 本阶段只做 **模型 + 纹理 + 预览验证**，不碰地图搭建（地形/水面/天空/灯光/关卡数据）。
> 下一步（地图阶段）按本文第 8 节的 layout 契约填 `src/config/maps/<id>/` 并写地形/水面/光照。

本文件是团队共享契约：**模型 id、面数预算、材质键、纹理键、layout 键以本文为准，不得擅自改名。**

---

## 1. 美术方向（写模型和纹理前先读）

### 1.1 场景气质

| 维度 | 方向 |
| --- | --- |
| 时间 | 清晨 06:30–08:00，太阳高度角约 **12–18°**，从东偏南方向斜射 |
| 主光 | 暖金色 `#ffd7a2`，强对比；树叶有透光感、逆光边缘泛金 |
| 补光/环境 | 天空冷青色 `#9cc7d2` + 地面绿色反弹 `#4e6b3a`，阴影冷、暗部不死黑 |
| 湿度 | 空气有薄雾（地图阶段做体积感），物体表面偏"湿"：叶面高光窄、石头/木头暗部更深 |
| 植被 | **层层叠叠的雨林冠层**：高乔木 → 椰树 → 竹丛 → 芭蕉/蕨类 → 地被草。绿色分 5 级以上明度层次 |
| 建筑 | 蓝灰绿色调的火山岩遗迹 + 褪色木/竹/茅草草村；青苔、藤蔓、蕨类从缝里长出来 |
| 水 | 环岛浅滩→深水渐变，岸边白浪线、礁石湿痕（地图阶段做，模型只需给出岸边要素） |

### 1.2 色彩脚本（底色，纹理绘制基准）

| 用途 | 色值参考 |
| --- | --- |
| 雨林地被草 | `#3f6b32` → `#5f8c3e`，苔藓黄绿 `#7f8f3c` |
| 腐叶土 | `#2f2619` → `#4a3a24`，湿泥 `#241d14` |
| 阔叶正面 | `#2f6b35` → `#4f8f3c`；背面/嫩叶 `#6f9e46`；枯叶边 `#9a8a4a` |
| 椰树/棕榈叶 | `#3f7a3a` → `#69a34a`（比沙漠棕榈更绿、更亮） |
| 树干 | 雨林乔木 `#4a3f30` + 苔藓 `#5b6b3a`；椰树干 `#6b5b45` |
| 茅草 | 新草 `#c9a55f` → 旧草 `#8a6c3a`，脊部受光 `#e0c07a` |
| 木/竹 | 干栏木 `#6b4a30`；竹 `#a9a86a` → `#8d8c55`（带灰） |
| 遗迹石 | 火山岩灰 `#5f5a52` + 青苔 `#4c6b3a` + 水渍 `#3c3a34` |
| 岸边沙 | 珊瑚白 `#e2d6b2` → 湿沙 `#b9a883` |
| 浮木 | 漂白 `#b8b1a0` |

> 所有纹理仍是**运行时 Canvas2D 程序化生成**（项目硬性约束：零外部资源、零网络请求）。
> 每张贴图颜色空间规范照旧：albedo = sRGB，normal/roughness/orm = linear。

### 1.3 与现有沙漠素材的关系

- **能复用就复用**（第 4 节），但所有沙漠沙子/土坯/锈铁**不能直接当热带材质用**——新材质通过"同贴图 + 调色 + 新贴图"组合解决。
- 现有 `palm` 棕榈树是干热风格（叶色偏黄褐）。新地图主用新做的 `coconut-palm`（更绿更高），原 `palm` 只在少数过渡位置做点缀，避免"沙漠感"。

---

## 2. 模型清单（P0 = 本阶段必须交付）

统一规范（全部模型适用）：

1. 单位 **米**，`+Y` 向上，模型**底部贴地**：舞台统计 `minY ∈ [-0.05, +0.05]`（根系允许 -0.02 微入土）。
2. 朝向约定：正面（门、脸、舟头）朝 **-Z**，这样舞台 `FRONT` 视角看到正面。
3. 每个模型在舞台（`build(ctx)`，`ctx.stage === true`）里构建 **1 个 hero 实例**（簇类模型的一簇 = 一个实例）；三角面数统计即该实例的总面数。
4. 面数必须落在下表区间（`window.__stage.stats().triangles`）。超了就砍隐藏面/降低圆柱分段/减少叶片卡片；低于下限说明细节不足，要看得出"这是一个认真做过的东西"。
5. 造型优先用**合并几何 + 少量 alpha 叶片卡片**；叶片卡片是雨林密度和阴影斑驳的关键，不要用实心大块面代替。
6. 所有可数重复物（叶片、藤条、瓦砾、竹节）用固定 seed 的 `makeRNG()`，保证每次构建一致。

### 2.1 植被 FLORA（group: `flora`，layout 键 `island.*`）

| # | id | 标签 | 面数目标 | 占地/高度 | 造型要点 | layout 键 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `jungle-tree` | 巨冠乔木 · JUNGLE TREE | **12,000–16,000**（地图 LOD **≤8,000**/棵） | 9×14×9 m | 程序化多变异：主枝/板根/附生床由 `tree/skeleton.js`+`species.js` 生成，4 套变体几何共享同一叶簇图集；冠层用 lib.canopy 叶簇卡（一张卡 = 6–18 片小叶）做外壳+中层+内膛 AO 三层；逆光透光 | `island.jungleTrees` |
| F2 | `coconut-palm` | 椰子树 · COCONUT PALM | **6,000–9,000** | 4×8.5×4 m | 2 变体；弯曲树干（真实几何环带 + 叶鞘 boots）、冠部 14–18 片下垂叶、椰果簇 | `island.coconutPalms` |
| F3 | `banana-plant` | 芭蕉丛 · BANANA PLANT | **2,500–4,500** | 3×2.8×3 m | 3–5 株、大桨叶（纵向撕裂缺口）、叶柄/叶鞘领圈、枯叶裙、小果串 | `island.bananaPlants` |
| F4 | `fern-clump` | 蕨类丛 · FERN CLUMP | **1,500–3,000** | 2.4×1.6×2.4 m | 地面莲座状蕨叶（V 形曲面）+ 树蕨（带毛茎）、卷芽、地被过渡 | `island.fernClumps` |
| F5 | `bamboo-clump` | 竹丛 · BAMBOO CLUMP | **3,000–6,000** | 3.5×6×3.5 m | 5–9 根竹（竹节环、斜切端口）、枝叶轮（每轮 3 叶簇）、枯竹、笋壳 | `island.bambooClumps` |
| F6 | `broadleaf-bush` | 阔叶灌木 · BROADLEAF BUSH | **1,500–3,000** | 2.6×2×2.6 m | 四层叶簇（外壳/中层/内膛 canopyDark/嫩叶）、细枝骨架、枯叶、地被卡 | `island.bushes` |
| F7 | `vine-drape` | 藤蔓垂帘 · VINE DRAPE | **1,200–2,500** | 1.6×4.5×1.6 m | 2 变体；3–5 条下垂藤（卷曲、粗细变化）、顶部断枝嵌冠、气生根、叶簇卡 | `island.vineDrapes`（需 `y` 挂点，见 §8） |
| F8 | `fallen-log` | 倒木 · FALLEN LOG | **2,500–5,000** | 5.5×1.6×2.2 m | 倒伏树干（断口、裂痕）、沿圆柱曲率贴的苔藓小垫、2 簇随机菌菇、薄根盘 | `island.fallenLogs` |
| F9 | `grass-tuft` | 雨林草簇 · GRASS TUFT（P1） | **1,000–1,800** | 1.2×0.9×1.2 m | lib.grassBlade 草簇卡三层（tuft/tuftTall/tuftDry）+ 少量宽叶杂草/穗头；是地面轮廓的主力 | `island.grassTufts` |

> **画质档分级（`ctx.quality` @ build 期）**：树变体 ultra/high=4、medium=3、low=2、lowest=1；
> 叶卡/草卡数量 ×1.0/×0.85/×0.75/×0.6/×0.55；lowest 关闭树冠阴影投射。
> **地图 LOD**：`jungle-tree` 单棵 stage 14.7k → 地图 7.4k tris（63 棵 ≤ 50 万），全部靠叶卡密度降级实现，几何拓扑一致。

### 2.2 草村 VILLAGE（group: `village`）

| # | id | 标签 | 面数目标 | 占地 | 造型要点 | layout 键 |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | `thatch-hut` | 茅草干栏屋 · THATCH HUT | **12,000–18,000** | 7×6.5×7 m | 高脚（6 根木桩）+ 编织墙 + 大坡茅草顶（分层草排、脊压条）+ 木梯 + 前廊栏杆 + 门洞/窗洞 + 檐下挂物（陶罐/鱼干/绳） | `island.huts` |
| V2 | `hut-ruin` | 破败茅屋 · HUT RUIN | **6,000–10,000** | 6×4.5×6 m | 屋顶塌陷一半、断桩、焦黑梁、散落草排、藤蔓侵入 | `island.hutRuins` |
| V3 | `bamboo-fence` | 竹篱 · BAMBOO FENCE | **2,000–4,000** | 4×1.5×0.4 m | 立柱 + 横杆 + 斜插竹片 + 绳结；一端可带小门框 | `island.fences` |
| V4 | `drying-rack` | 晾晒架 · DRYING RACK | **1,500–3,500** | 3×2.5×1.6 m | 竹木架、绳网、挂鱼/海带、下面竹筐 | `island.dryingRacks` |
| V5 | `village-walkway` | 村中栈道 · WALKWAY | **3,000–6,000** | 6×1.8×2 m | 架空竹木栈道 + 单侧栏杆 + 台阶 + 绑扎节点 | `island.walkways` |
| V6 | `spirit-totem` | 木雕图腾 · SPIRIT TOTEM（P1） | **2,000–4,000** | 1.2×3.5×1.2 m | 三段式雕刻柱（眼睛/獠牙/纹样）、苔藓、祭祀小物件 | `island.totems` |

### 2.3 遗迹 RUINS（group: `ruin`）

| # | id | 标签 | 面数目标 | 占地 | 造型要点 | layout 键 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | `ruin-wall` | 遗迹残墙 · RUIN WALL | **4,000–8,000** | 6×3.2×1.2 m | 砌块墙残段（高低不齐）、错缝、苔藓带、树根/藤蔓爬墙、坍塌堆石 | `island.ruinWalls` |
| R2 | `ruin-arch` | 遗迹拱门 · RUIN ARCH | **5,000–9,000** | 6×5×2.2 m | 半塌石拱（一侧断柱）、拱石楔形分块、顶部崩口、藤蔓垂挂 | `island.ruinArches` |
| R3 | `ruin-tower` | 崩塌石塔 · RUIN TOWER | **10,000–16,000** | 6×9×6 m | 方形石塔残体（顶部塌成斜面）、窗洞、内部碎石、外挂藤、基座台阶 | `island.ruinTowers` |
| R4 | `ruin-idol` | 断裂石像 · RUIN IDOL | **2,500–5,000** | 2.6×3.2×2.4 m | 半埋的巨型石雕头/胸像（风化、缺角、眼窝、纹样）、周围碎石与蕨类 | `island.ruinIdols` |
| R5 | `ruin-column` | 断裂石柱 · RUIN COLUMN（P1） | **2,000–4,000** | 1.4×2.6×1.4 m | 柱础 + 立着的断柱 + 2–3 段倒伏柱鼓 | `island.ruinColumns` |

### 2.4 海岸 SHORE（group: `shore`）

| # | id | 标签 | 面数目标 | 占地 | 造型要点 | layout 键 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | `shore-rocks` | 岸礁石群 · SHORE ROCKS | **3,000–7,000** | 5×2.4×4 m | 多块湿岩（水下部分更深色）、潮池小水面、藤壶/贝壳点、草丛从缝里长出 | `island.shoreRocks` |
| S2 | `jetty` | 木栈桥 · JETTY | **5,000–9,000** | 9×3×2.4 m | 入水栈桥：立柱（浸水色）、横梁、木板面、单侧栏杆、系船桩 + 缆绳、灯柱 | `island.jetties` |
| S3 | `dugout-canoe` | 独木舟 · DUGOUT CANOE | **2,000–4,000** | 5×1.2×0.9 m | 挖空船身（内壁、横撑）、船桨、绳圈、磨损痕迹 | `island.canoes` |
| S4 | `driftwood` | 浮木 · DRIFTWOOD（P1） | **1,200–2,500** | 3.5×0.9×1.2 m | 漂白浮木（开裂、断根、磨圆）、缠海草 | `island.driftwood` |
| S5 | `wreck-boat` | 沉船残骸 · WRECK BOAT（P1） | **5,000–9,000** | 7×4×3 m | 半沉旧渔船：破洞船壳、断裂龙骨、锈蚀机件、缠网、藤壶 | `island.wrecks` |

> P1 共 5 个（F9、V6、R5、S4、S5）。**P0 全部完成并通过验收后**再按余量推进；P1 不允许挤占 P0 质量。

---

## 3. 新增纹理清单（12 个模块）

每个模块一个文件，放在 `src/textures/`，导出 `makeXxx(aniso, reg)`，返回 `{ map, normalMap, roughnessMap? }`。
两个聚合文件（`island-flora.js` / `island-structure.js`）把模块结果写进纹理库的 `lib.<key>`。
**不允许外部图片，全部 Canvas2D 程序化。**

### 3.1 植被组（文件归属：texture-flora）

| 纹理模块 | lib 键 | 材质键 | 尺寸/平铺 | 内容要求 |
| --- | --- | --- | --- | --- |
| `jungle-grass.js` | `jungleGrass` | `jungleGrass` | 1024²，1 tile = **4 m** | 雨林地被：密集细草 + 苔藓斑 + 小阔叶 + 泥土缝；湿润偏暗，无沙粒感 |
| `leaf-litter.js` | `leafLitter` | `leafLitter` | 1024²，1 tile = 4 m | 腐叶层：大小落叶（深浅棕/黄绿）、枝梗、湿泥、菌丝；可平铺 |
| `broadleaf.js` | `broadleaf` | `broadleaf` / `broadleafDark` | 1024×1024 **2×2 图集**（4 格叶卡） | 格布局固定（见下）：左上 `broad` 龟背阔叶、右上 `banana` 芭蕉长叶（带撕裂缺口）、左下 `fern` 羽状蕨叶、右下 `vine` 藤蔓小叶串；**背景全透明**（alpha 裁切），叶片有明暗渐变、叶脉、露水高光点、虫蛀洞。§11 pass-2 起每格内容内缩到 92%，保证 ≥6% mip 安全边距 |
| **`canopy.js`** | `canopy` | `canopy` / `canopyDark` / `canopyPale` / `vegLeaf` / `vegLeafDark` / `vegLeafPale` | 1024² **2×2 图集（叶簇卡）** | **一张卡 = 一根小枝带 6–18 片小叶**，从 GT 移植的"叶片簇卡"思路：左上 `sprig`（4–8 叶、小枝+叶柄）、右上 `spray`（12–18 叶、羽状）、左下 `pale`（嫩叶黄绿）、右下 `dry`（枯叶）；每片叶有独立调色抖动、锯齿边缘、叶间自阴影（source-atop）、逆光尖端透光、蜡质高光与叶脉凹槽；返回 map+normalMap |
| **`grass-blade.js`** | `grassBlade` | `grassBlade` / `grassBladeDry` | 1024² **2×2 图集（草簇卡）** | **一张卡 = 一整簇 15–24 片锥形草叶**：左上 `tuft`（12–18 cm 密草）、右上 `tuftTall`（25–40 cm 细高）、左下 `tuftDry`（枯草）、右下 `cover`（低矮圆叶地被+苔藓垫）；叶片有基部暗→尖端亮渐变、单侧高光脊、深色剪影边；返回 map+normalMap |
| `tropical-frond.js` | `tropicalFrond` | `frondLush` | 256×256（沿用旧棕榈叶版式） | **必须与现有 `src/textures/palm.js` 相同构图**（中央叶轴 + 上下两排小叶），只是颜色换成饱和雨林绿，带露水；这样 `frondLush` 能直接套现有棕榈叶几何 |
| `beach-sand.js` | `beachSand` | `beachSand` | 1024²，1 tile = 3 m | 珊瑚白/浅金细沙：贝壳碎屑、湿润深浅带、小卵石；颗粒比沙漠沙细 |

**broadleaf 图集格子契约**（模型侧统一用 `src/models/world/island/leaf-atlas.js` 的
`leafQuad()` / `leafCellUV()`，不要手写 UV）。下表是**画布像素坐标**（y 向下，纹理作者看到的布局）：

```
      u: 0            0.5           1
 y 0    +--------------+--------------+
        | broad        | banana       |
 y 0.5  +--------------+--------------+
        | fern         | vine         |
 y 1    +--------------+--------------+
```

> 画布 y=0 在纹理 UV 里是 **v=1**（WebGL flipY），`leaf-atlas.js` 的 `LEAF_CELLS`
> 已经做了这层换算——模型作者直接用 `leafQuad()/leafCellUV()` 即可，**不要**再自己翻 V。

- 每格叶片朝 **+U 方向**（叶尖在格子右边缘）；每格内留 ~5% 透明边距，防止 mipmap 串色。
- 返回 `{ map, normalMap }`；`map` 用 sRGB，`normalMap` 用 linear。material 的
  `alphaTest = 0.4`（已接线），所以 alpha 通道必须干净（不要半透明叶片）。

**canopy 叶簇图集格子契约**（模型侧统一用 `leaf-atlas.js` 的 `canopyQuad()` / `canopyCellUV()`）：

```
      u: 0            0.5           1
 y 0    +--------------+--------------+
        | sprig        | spray        |   <- 6-18 片小叶 + 小枝
 y 0.5  +--------------+--------------+
        | pale         | dry          |
 y 1    +--------------+--------------+
```

- 一张卡 = 一根小枝带 6–18 片小叶（单叶有效尺寸 0.1–0.2 m），地形不涨三角形而密度翻倍。
- 卡片局部坐标：`+X` = 叶尖方向（朝外），`+Y` = 叶轴向上，宽度沿 `+Z`；`canopyQuad(w,h,cell,{cols,rows,bend,droop,twist})` 会做 UV 与曲面。
- 四格是**内容变体而非方向变体**：`sprig` 主用、`spray` 补密度、`pale` 冠顶嫩叶、`dry` 枯叶/地面碎屑。

**grassBlade 草簇图集格子契约**（模型侧用 `grassQuad(w,h,cell,{bend,lean})` / `grassCellUV()` 与 `GRASS_CELLS`）：

```
      u: 0            0.5           1
 v 0    +--------------+--------------+
        | tuft         | tuftTall     |   <- 根在格底，叶尖向上（+V）
 v 0.5  +--------------+--------------+
        | tuftDry      | cover        |
 v 1    +--------------+--------------+
```

- 与叶图集不同：**叶片沿 +V 生长（根在格底）**，`grassQuad()` 已按此映射（卡片底部在 y=0）。
- 一张卡 = 一整簇草，所以一丛草只需 10–20 张卡（旧做法是 70+ 张 warp 单叶卡）。
- `cover` 格是低矮地被（圆叶+苔藓），用于裸土边缘/树根处过渡。


### 3.2 结构组（文件归属：texture-structure）

| 纹理模块 | lib 键 | 材质键 | 尺寸/平铺 | 内容要求 |
| --- | --- | --- | --- | --- |
| `thatch.js` | `thatch` | `thatch` / `thatchDark` | 1024²，1 tile = **2 m** | 茅草：沿一个方向的草茎层叠、捆扎压条、日晒褪色渐变、边缘散草；法线要强（草茎起伏） |
| `tropical-bark.js` | `tropicalBark` | `barkTrop` / `barkMoss` | 1024²，1 tile = 2.5 m | 热带树皮：纵向深裂纹 + 横向皮孔 + 苔藓斑块 + 湿痕；可平铺 |
| `bamboo.js` | `bamboo` | `bamboo` | 512×1024，1 tile = 1.2 m | 竹黄：纵向纤维、竹节环带、斑点、烟熏痕；**V 方向 = 竹长方向**，横向平铺无缝 |
| `moss-stone.js` | `mossStone` | `mossStone` / `ruinStone` / `shoreRock` | 1024²，1 tile = 2 m | 火山岩砌块 + 浓密青苔（成片、有亮暗层次）+ 水渍/雨痕 + 苔间裂纹 |
| `woven-wall.js` | `woven` | `woven` / `rope` | 1024²，1 tile = 1.5 m | 编织竹/藤席纹（上下交错、有厚度感）+ 棕绳纤维；用于草村墙、绳网、缆绳 |

> `thatch`：**V 方向 = 草茎顺坡方向**，模型把茅草顶 UV 的 V 对应屋面坡向；U 方向重复平铺。
> 结构纹理都返回 `{ map, normalMap }`（`mossStone` 额外返回 `roughnessMap` 更好）。

---

## 4. 复用现有资产（不重复造）

| 现有模型/纹理 | 用途 |
| --- | --- |
| `src/models/world/palm.js` + `M.frond` | 少量点缀（可换 `frondLush` 材质变绿） |
| `rubble` / `stone` / `stoneDark` | 遗迹堆石、岸边碎石基座 |
| `crate` / `sacks` / `barrel` / `cart` | 草村生活道具（换新材质或用原色，老木感可接受） |
| `campfire` | 草村/营地篝火（已有灯、烟、火） |
| `lamp-post` / `lantern` 系统 | 栈桥/村口灯（清晨熄灯状态可调低亮度） |
| `banner` / `awning` / `cloth` | 草村布幔（换绿色/米色 `tarp` 变体） |
| `sandbag` | 草村/遗迹沙袋不违和，少量点缀 |
| `well`（改色） | 村中井（可做 `M.adobeLight`→石色变体，P1） |
| 纹理：`wood` / `sheet` / `metal` / `rust` / `stone` / `cloth` / `sand` | 结构件、铁件、旧船、远景；新增材质只做彩色变体，不复制贴图 |

---

## 5. 材质 / 批次键契约（Lead 统一接线）

`src/world/materials.js` 新增 `M.*`（均已用 `??` 回退到现有贴图，纹理模块落地后自动生效）：

| 批次键（batcher key） | 材质 | surface | 说明 |
| --- | --- | --- | --- |
| `jungleGrass` | `M.jungleGrass` | `sand` | 地被，bakeAO |
| `leafLitter` | `M.leafLitter` | `sand` | 腐叶土，bakeAO |
| `broadleaf` | `M.broadleaf` | `fabric` | **alphaTest 叶片卡**，castShadow，不参与碰撞/贴花 |
| `broadleafDark` | `M.broadleafDark` | `fabric` | 暗部/背面叶卡 |
| `canopy` / `canopyDark` / `canopyPale` | `M.canopy*` | `fabric` | **叶簇卡**（vertexColors 关闭，任何几何都能用；灌木/蕨/竹/苔藓 / 藤用这组） |
| `vegLeaf` / `vegLeafDark` / `vegLeafPale` | `M.vegLeaf*` | `fabric` | **树专用叶簇卡**：`vertexColors: true`，几何**必须**带 `color` 属性 `(r=AO, g=flex 风摆权重, b=hue 色相抖动)`，否则整片全黑 |
| `grassBlade` / `grassBladeDry` | `M.grassBlade*` | `fabric` | **草簇卡**（草簇图集，alphaTest 0.35） |
| `frondLush` | `M.frondLush` | `fabric` | 椰树/棕榈叶（alphaTest） |
| `thatch` / `thatchDark` | `M.thatch` / `M.thatchDark` | `fabric` | 茅草顶（双面） |
| `barkTrop` | `M.barkTrop` | `wood` | 雨林树皮 |
| `barkMoss` | `M.barkMoss` | `wood` | 苔藓树皮/倒木 |
| `bamboo` | `M.bamboo` | `wood` | 竹 |
| `mossStone` / `ruinStone` / `ruinStoneDark` | `M.mossStone` / `M.ruinStone` / `M.ruinStoneDark` | `stone` | 遗迹石（bakeAO）；`ruinStoneDark` 与 `ruinStone` 同用火山岩贴图（不是沙漠 `stoneDark`） |
| `shoreRock` | `M.shoreRock` | `stone` | 岸礁 |
| `beachSand` | `M.beachSand` | `sand` | 岸沙 |
| `woven` / `rope` | `M.woven` / `M.rope` | `fabric` | 编织墙/绳 |
| `driftWood` | `M.driftWood` | `wood` | 浮木 |
| `mud` | `M.mud` | `sand` | 湿泥/树根区 |

> 模型只写批次键，不 import 材质、不 import 纹理。`ensureBatches(ctx)` 已注册全部键。
> alpha 叶片材质必须设 `alphaTest > 0`（three r170 的阴影深度材质会跟着 alpha 裁切，剪影和树冠阴影才正确）。
>
> **风摆 / 逆光 / 阴影同步（`src/world/foliage-fx.js`）**：所有 alpha 叶/草材质在
> `materials.js` 里统一过一遍 `applyFoliageFx()`——注入世界空间风摆（振幅随世界高度增加）、
> 逆光透光（`<lights_fragment_end>`）与 `customDepthMaterial`（阴影跟着摆）。模型作者不用管，
> 但要知道：**每帧的 uTime 由 `world/update.js` 更新、风力倍率按画质档在 `world/index.js` 设置**；
> 顶点色打包模式（`M.vegLeaf*`）下 `color.g` 是逐顶点风摆权重，`color.r` 是 AO，`color.b` 是色相抖动。

---

## 6. 模型文件规范

### 6.1 文件位置

```
src/models/world/island/
  index.js              # 汇总 5 个族桶（Lead 维护）
  flora-canopy.js       # F1–F3、F7 桶（owner: flora-canopy）
  flora-understory.js   # F4–F6、F8、F9 桶（owner: flora-understory）
  village.js            # V1–V6 桶（owner: village）
  ruins.js              # R1–R5 桶（owner: ruins）
  shore.js              # S1–S5 桶（owner: shore）
  jungle-tree.js coconut-palm.js …   # 每个模型一个文件
```

### 6.2 单文件模板（照抄骨架）

```js
import * as THREE from 'three';
import { makeInstanced, matrixFor, TAU } from '../../core.js';
import { makeRNG } from '../../../utils.js';
import { cylGeo, plateGeo, put, emit } from '../detail.js';

export const meta = { id: 'jungle-tree', kind: 'world', group: 'flora', label: '巨冠乔木 · JUNGLE TREE' };

/** 舞台预览：给一份样例 layout，然后建 1 个 hero 实例。 */
export function build(ctx) {
  island(ctx).jungleTrees = [{ x: 0, z: 0, ry: 0.35, s: 1 }];
  buildJungleTrees(ctx, true);
}

/** 地图装配：从 map JSON 的 layout.island 读实例；没有数据就什么都不做（旧地图安全）。 */
export function buildWorld(ctx) {
  buildJungleTrees(ctx, false);
}

function island(ctx) {
  const L = ctx.data.layout;
  L.island = L.island || {};
  return L.island;
}

function buildJungleTrees(ctx, preview) {
  const items = island(ctx).jungleTrees || [];
  if (!items.length) return;
  // …建几何（preview 可 s 用 1 个实例）…
  // makeInstanced(ctx, geo, ctx.materials.broadleaf, items, 'jungle-tree-canopy', 'fabric', { seed: 71 });
}
```

### 6.3 硬性要求

- 三角面在预算区间内（舞台统计为准）。
- `minY` 贴地；模型不要悬空、不要整棵树歪到一边导致 bbox 失衡。
- **叶片卡一律用 `./leaf-atlas.js` 的 `leafQuad()`**（映射 `broadleaf` / `broadleafDark` 批次），
  椰树/棕榈叶用 `M.frondLush` 材质 + 旧棕榈叶 UV 版式。
- 不用 `ctx.req.*`（布幔/贴花/灯）除非确有必要；用了要在文件里注明并在汇报里提醒 Lead 已 `materialize`。
- 不改 `src/` 下非本人 scope 的文件；桶文件只 append 自己的 import + 条目。
- 不新增外部依赖，不引入 `three/addons/*` 之外的东西（addons 已 vendored）。

---

## 7. 验收标准（每个模型/每个纹理）

1. `node scripts/check.mjs` —— 语法/引用全绿（Lead 统一跑）。
2. 舞台可加载：`http://127.0.0.1:5199/?tab=models&m=<id>`（先 `npm run dev:tools`），`window.__stage.errors` 为空。
3. `window.__stage.stats()`：`triangles ∈ [预算下限, 预算上限]`，`minY ∈ [-0.05, 0.05]`。
4. `window.__stage.missingMaterials()` 不含本模型用到的键。
5. 四视图截图（3/4、FRONT、SIDE、BACK）目测：轮廓成立、叶卡不出现整片实心、茅草/石砌有层次、贴地。
6. 低质量档（`?quality=medium`）下也正常（贴图不至于糊成一团）。
7. 现有 `outpost-07` 地图视觉零回归（Lead 用 `world-verify --compare` 证明）。

### 7.1 自检命令（每位作者交付前必须跑）

游戏开发服务器在 `http://127.0.0.1:8080`（`node serve.mjs`）；模型舞台 / 截图自动化走 dev tools：`npm run dev:tools` → `http://127.0.0.1:5199/`。

```powershell
# 1) 语法
node --check src/models/world/island/jungle-tree.js

# 2) 舞台加载 + 统计（可一次看多个 id；GPU=1 更快）
$env:GPU='1'; node .scratch/island/smoke.mjs jungle-tree coconut-palm
#    -> 看 triangles / minY / missing / errors；缺材质时 missing 会列出来

# 3) 四视图 contact sheet（每个模型一张 jpg，输出目录按族分开，互不覆盖）
$env:GPU='1'; node scripts/model-shots.mjs --only=jungle-tree,coconut-palm --out=shots/island/flora-canopy --quality=high
#    -> shots/island/flora-canopy/jungle-tree.jpg 等；用看图工具/read_image 目测
```

纹理作者的自检：

```powershell
$env:GPU='1'; node .scratch/island/tex-sheet.mjs --only=thatch,bamboo,mossStone --out=shots/island/textures-structure.jpg
#    -> 生成 ALBEDO / NORMAL / ROUGH 三联缩略图（数据直接来自运行时纹理库）
```

> dev tools 的模型查看器（`http://127.0.0.1:5199/?tab=models`）会一次性加载**全部**模型模块：如果别的作者正在写文件导致 boot 报错，
> 先确认报错文件不在自己 scope 内，等 1–2 分钟重试；持续失败就报给 Lead。


---

## 8. 给"下一步地图搭建"的 layout 契约

地图 JSON（`src/config/maps/island-01/` 之类）的 `layout.island` 字段：

```jsonc
{
  "jungleTrees":  [{ "x": 0, "z": 0, "ry": 0.0, "s": 1.0 }],
  "coconutPalms": [],
  "bananaPlants": [],
  "fernClumps": [],
  "bambooClumps": [],
  "bushes": [],
  "vineDrapes": [],
  "fallenLogs": [],
  "grassTufts": [],
  "huts": [], "hutRuins": [], "fences": [], "dryingRacks": [], "walkways": [], "totems": [],
  "ruinWalls": [], "ruinArches": [], "ruinTowers": [], "ruinIdols": [], "ruinColumns": [],
  "shoreRocks": [], "jetties": [], "canoes": [], "driftwood": [], "wrecks": []
}
```

- 实例字段沿用现有惯例：`x`/`z` 必填，`y` 可选（默认 0），`ry` 弧度，`s` 统一缩放。
- 每个模型 `buildWorld()` 自动实例化自己的数组；**空数组/字段缺失 = 不生成**，因此新地图可以先只填一部分。
- `vineDrapes` 必须给挂点高度：`{ "x":…, "z":…, "y":1.2–1.8, "ry":… }`，并放在 `jungleTrees` 冠层边缘
  （半径 2.0–3.4 m）。`y = 0` 会让"断枝锚"悬在半空，pass-1 的"晾衣架"问题就是这么来的；
  pass-2 已把 30 个实例全部改成 y=1.2–1.8 并坐到最近乔木冠缘（脚本 `.scratch/island-pass2/fix-vine-layout.mjs`）。
- 软植被（`bushes`/`fernClumps`/`grassTufts`/`bananaPlants`/`vineDrapes`）**没有碰撞盒**，可以放心加密
  （pass-2 加散点脚本 `.scratch/island-pass2/scatter-understory.mjs`：grassTufts +82 / bushes +10 / fernClumps +8，仍保持全岛 0 悬浮）。
- 下一步地图阶段还要新建：`terrain.js` 分支（岛形/海滩/海床）、水面 shader、清晨天空/雾、湿气光束/萤火、碰撞与出生点。

---

## 9. 团队分工（写作用域，互不重叠）

| 成员 | 写作用域 | 交付 |
| --- | --- | --- |
| Lead | `ISLAND_ASSETS.md`、`src/world/materials.js`、`src/world/architecture.js`、`src/textures/index.js`、`src/models/world/index.js`、`src/models/world/island/index.js`、`dev_tools/ui/src/components/ModelViewer.jsx`、`dev_tools/ui/src/stage/model-stage.js`、`MODELS.md`、`README.md` | 契约、接线、集成、最终回归与交付 |
| texture-flora | `src/textures/island-flora.js`、`jungle-grass.js`、`leaf-litter.js`、`broadleaf.js`、`tropical-frond.js`、`beach-sand.js` | 5 套植被纹理 + 聚合 |
| texture-structure | `src/textures/island-structure.js`、`thatch.js`、`tropical-bark.js`、`bamboo.js`、`moss-stone.js`、`woven-wall.js` | 5 套结构纹理 + 聚合 |
| flora-canopy | `src/models/world/island/flora-canopy.js`、`jungle-tree.js`、`coconut-palm.js`、`vine-drape.js` | F1/F2/F7 |
| flora-understory | `src/models/world/island/flora-understory.js`、`banana-plant.js`、`fern-clump.js`、`broadleaf-bush.js`、`bamboo-clump.js`、`fallen-log.js`、`grass-tuft.js` | F3–F6/F8/F9 |
| village | `src/models/world/island/village.js`、`thatch-hut.js`、`hut-ruin.js`、`bamboo-fence.js`、`drying-rack.js`、`village-walkway.js`、`spirit-totem.js` | V1–V6 |
| ruins | `src/models/world/island/ruins.js`、`ruin-wall.js`、`ruin-arch.js`、`ruin-tower.js`、`ruin-idol.js`、`ruin-column.js` | R1–R5 |
| shore | `src/models/world/island/shore.js`、`shore-rocks.js`、`jetty.js`、`dugout-canoe.js`、`driftwood.js`、`wreck-boat.js` | S1–S5 |
| island-qa | `shots/island/**`、`.scratch/island/**`（只读源码） | 截图/统计/验收报告，不改产品代码 |

---

## 10. 交付状态（首轮交付完成 · 2026-11-14）

### 10.1 结论

**25/25 模型 + 10/10 纹理全部交付并通过验收**，模型全部接入 `MODEL_CATALOG`，模型查看器
新增 FLORA / VILLAGE / RUIN / SHORE 分组；`outpost-07` 地图零回归。下一步可以直接进入地图搭建。

### 10.2 模型清单（舞台统计，`build(ctx)` hero 实例）

| id | 族 | tris | 预算 | minY | 尺寸 (x×y×z m) |
| --- | --- | ---: | ---: | ---: | --- |
| jungle-tree | flora | 15,404 | 12k–16k | 0.000 | 8.78×14.06×8.78 |
| coconut-palm | flora | 7,092 | 6k–9k | 0.000 | 3.94×8.39×3.83 |
| vine-drape | flora | 2,260 | 1.2k–2.5k | 0.000 | 1.80×4.44×1.55 |
| banana-plant | flora | 3,848 | 2.5k–4.5k | -0.039 | 3.30×2.94×3.25 |
| fern-clump | flora | 2,874 | 1.5k–3k | -0.031 | 2.27×1.53×2.21 |
| bamboo-clump | flora | 5,460 | 3k–6k | -0.040 | 3.72×5.95×3.61 |
| broadleaf-bush | flora | 2,846 | 1.5k–3k | -0.026 | 2.37×1.92×2.37 |
| fallen-log | flora | 2,936 | 2.5k–5k | -0.045 | 5.41×1.55×1.74 |
| grass-tuft | flora (P1) | 1,016 | 1k–1.8k | -0.016 | 1.36×0.79×1.43 |
| thatch-hut | village | 17,524 | 12k–18k | -0.011 | 7.32×6.53×7.09 |
| hut-ruin | village | 7,242 | 6k–10k | -0.018 | 6.43×4.53×5.95 |
| bamboo-fence | village | 3,604 | 2k–4k | -0.002 | 4.33×1.55×0.71 |
| drying-rack | village | 3,436 | 1.5k–3.5k | -0.037 | 3.23×2.53×1.75 |
| village-walkway | village | 3,610 | 3k–6k | 0.000 | 6.49×2.04×1.85 |
| spirit-totem | village (P1) | 3,608 | 2k–4k | -0.024 | 1.44×3.55×1.39 |
| ruin-wall | ruin | 7,020 | 4k–8k | -0.004 | 6.16×3.27×2.47 |
| ruin-arch | ruin | 7,668 | 5k–9k | -0.030 | 6.25×5.33×3.16 |
| ruin-tower | ruin | 15,362 | 10k–16k | 0.000 | 6.19×8.73×6.46 |
| ruin-idol | ruin | 3,872 | 2.5k–5k | -0.037 | 2.89×3.18×2.29 |
| ruin-column | ruin (P1) | 2,714 | 2k–4k | -0.030 | 1.86×2.69×1.72 |
| shore-rocks | shore | 6,746 | 3k–7k | -0.047 | 5.57×1.93×4.70 |
| jetty | shore | 8,820 | 5k–9k | -0.036 | 9.59×2.44×3.00 |
| dugout-canoe | shore | 3,768 | 2k–4k | -0.023 | 1.50×0.80×4.57 |
| driftwood | shore (P1) | 2,298 | 1.2k–2.5k | -0.036 | 3.53×0.68×2.45 |
| wreck-boat | shore (P1) | 5,264 | 5k–9k | -0.046 | 4.70×2.44×6.84 |

地图 LOD（`buildWorld`，`hi=false`）参考：jungle-tree ≈9,950 / 棵、coconut-palm ≈4,828 / 棵、
vine-drape ≈1,560 / 个，其余模型基本沿用同几何 instancing。

### 10.3 纹理清单（10/10，全部运行时程序化生成）

`jungleGrass`（1024²/4m，地被草+苔藓+小阔叶）、`leafLitter`（1024²/4m 腐叶层）、
`broadleaf`（1024² 2×2 alpha 叶卡图集，RGB-bleed 防 mip 黑边）、`tropicalFrond`
（256²，沿用旧 palm 构图）、`beachSand`（1024²/3m 珊瑚沙）、`thatch`（1024²/2m 茅草）、
`tropicalBark`（1024²/2.5m 苔藓树皮）、`bamboo`（512×1024/1.2m）、`mossStone`
（1024²/2m 火山岩砌块+青苔，含 roughnessMap）、`woven`（1024²/1.5m 编织席/绳）。
缩略图：`shots/island/qa/textures.jpg`，单张原图 `.scratch/island/qa/tex/`。

### 10.4 验收证据

| 项目 | 命令 / 产物 | 结果 |
| --- | --- | --- |
| 静态检查 | `node scripts/check.mjs` | exit 0，0 error（含地图数据校验） |
| 数值验收 | `node .scratch/island/verify.mjs` → `.scratch/island/final-verify.json` | **25/25 PASS**，catalog 76，`missingMaterials=[]`，consoleErrors 0 |
| QA 全量审计 | `.scratch/island/qa/report.md` / `report.json` / `audit-final2.md` | 25/25 PASS + 10/10 纹理 PASS，视觉 P0 清零 |
| 截图 | `shots/island/qa/`（25 张四视图 + 20 closeup + textures.jpg） | 每个模型 3/4 · FRONT · SIDE · BACK |
| 资产总览 | `shots/island/overview-all.jpg`、`overview-flora/village/ruins-shore.jpg` | 交付验收图 |
| 旧地图回归 | `node scripts/world-verify.mjs --compare=island-before,island-after` | **PASS**（地图数据 100% 一致；截图差异来自并行进行的武器任务改动与布幔/尘埃动画相位） |

### 10.5 已知 P1（不阻塞，地图阶段可继续打磨）

- ruins：ruin-wall 砌块 UV/尺寸重复感、ruin-idol 五官可再强化、ruin-column 柱身凹槽。
- flora：coconut-palm 椰果簇可再放大、jungle-tree 附生植物可加密、bush/fern 叶卡比例。
- village：drying-rack 挂物形态、thatch-hut 檐口散草、hut-ruin 焦黑梁、walkway 悬空斜撑、totem 背面。
- shore：浅色礁石偏白、潮池水面不可读、wreck-boat 锈蚀机件/渔网、canoe 桨姿。
- texture：broadleaf 图集边距略小于 5%（mip 风险已用 RGB bleed 缓解）、mossStone 覆盖率偏高。
- 材质 tint 已按新贴图为基准校正（近白/淡绿），地图晨光下建议再整体复核一次绿量。

### 10.6 下一步地图搭建要点（可直接开工）

1. 新建地图 `src/config/maps/island-01/`（id / name / bounds / 出生点 / 敌人点 / 碰撞盒 / landmarks），
   `layout.island` 按第 8 节填实例数组；先填植被与关键地标，再补碰撞。
2. `src/world/terrain.js` 增加 island 地形模式：岛心高地 → 环岛沙滩 → 浅滩 → 深水；水面 shader +
   岸边白浪线 + 水下颜色渐变；四面环水保证封闭感。
3. `src/world/sky.js` / `lights.js` 清晨预设：低角度暖金主光（~12–18°）、冷青天光补光、
   雾/湿气、树冠下斑驳光；与 §1.1 光比一致。
4. 摆放：岛心密林（jungle-tree 为主）+ 边缘椰林 + 中低层竹/芭蕉/蕨 + 地被；草村集中一侧
   临水（栈道+码头），遗迹零散分布并用 ruin-wall/column 连成残迹群。
5. 性能：全部 `makeInstanced`；jungle-tree 用 map LOD（pass-2 起 ≈7,500/棵）；阴影贴图与雾距按
   远景植被密度调，保证 60fps。

---

## 11. 第二轮质量打磨（pass-2 · 2026-11-14）

> 触发：用户反馈"小岛上的模型很多还有瑕疵，树木的细节不够"。`island-audit` 先对 25 个模型做真实
> 状态审计（`.scratch/island-pass2/audit-pass2.md`，P0×9/P1×16/P2×3），再由 3 个 dev 按
> **GT（golden-temple）技术路线**重做。用户向交付说明见根目录 `ISLAND_QUALITY_PASS2.md`。

### 11.1 结论

- **树木体系按 GT 思路重建**：新增 `src/models/world/island/tree/` 程序化工具包
  （骨架 `growCurve`/包络/外壳填充/叶簇卡/顶点色打包），`jungle-tree` 4 变体、`coconut-palm` 2、
  `vine-drape` 2；叶簇卡把单叶有效尺寸从 0.5–1.4 m 降到 0.1–0.2 m，冠形从"叶柱"变成伞冠。
- **新增两张图集**：`lib.canopy`（叶簇卡，2×2）与 `lib.grassBlade`（草簇卡，2×2），
  配套 `M.canopy*`、`M.vegLeaf*`、`M.grassBlade*`、`M.ruinStoneDark` 与 `src/world/foliage-fx.js`
  （GPU 风摆 + 逆光透光 + `customDepthMaterial` 阴影同步）。
- **低速档真正降级了**：ultra/high 4 变体 / medium 3 / low 2 / lowest 1，叶卡数量按档 ×1.0/×0.75/×0.6，
  lowest 关树冠投影（pass-1 的 low=medium=high 几何完全相同）。
- **修掉一个全项目 bug**：`vertexColors:true` 材质在静态批合并后无 color 属性 → 实机遗迹/漂木全黑；
  `bakeVertexAO()` 改为乘法融合已有顶点色（舞台手调的逐块明暗/湿带现在实机也生效）。
- **修掉一个 P0 启动崩溃**：lowest 档某叶桶被裁空 → `mergeGeometries([])=null` → `InstancedMesh(null)`
  在视锥裁剪时崩；`makeInstanced()` 现在对 null 几何有守卫，`bamboo-clump`/`fern-clump` 的最低档
  桶也保留了 1 张卡（不再空）。
- 布局层：30 个 vineDrape 全部加 `y` 并重新坐到乔木冠缘；grassTufts +82 / bushes +10 / fernClumps +8
  （软植被无碰撞，`.scratch/island-pass2/scatter-understory.mjs`）。

### 11.2 pass-2 模型统计（stage hero，`numeric-lead.json` 实测）

| id | pass-1 tris | pass-2 tris | 预算 | 变化 |
| --- | ---: | ---: | ---: | --- |
| jungle-tree | 15,404 | **14,666** | 12k–16k | 4 变体 + 叶簇卡 |
| coconut-palm | 7,092 | **7,914** | 6k–9k | 2 变体 + 真几何环带 |
| vine-drape | 2,260 | **1,664** | 1.2k–2.5k | 2 变体 + 断枝锚 |
| banana-plant | 3,848 | **3,736** | 2.5k–4.5k | 叶鞘/枯叶裙 |
| fern-clump | 2,874 | **2,362** | 1.5k–3k | V 形蕨叶 + 树蕨 |
| bamboo-clump | 5,460 | **4,572** | 3k–6k | 枝叶轮 + 叶簇卡 |
| broadleaf-bush | 2,846 | **1,756** | 1.5k–3k | 四层叶簇 |
| fallen-log | 2,936 | **3,312** | 2.5k–5k | 苔藓垫/菌菇/根盘 |
| grass-tuft | 1,016 | **1,156** | 1k–1.8k | 草簇图集三层 |
| thatch-hut | 17,524 | **17,168** | 12k–18k | 檐口/脊散草 |
| hut-ruin | 7,242 | **7,992** | 6k–10k | 焦梁/藤叶/拆屋面 |
| bamboo-fence | 3,604 | **3,980** | 2k–4k | 端点吸附/绳结 |
| drying-rack | 3,436 | **3,418** | 1.5k–3.5k | 海带/鱼/编织筐 |
| village-walkway | 3,610 | **3,702** | 3k–6k | 斜撑吸附 |
| spirit-totem | 3,608 | **3,996** | 2k–4k | 背面浮雕 |
| ruin-wall | 7,020 | **7,598** | 4k–8k | 石材统一/UV 抖动 |
| ruin-arch | 7,668 | **8,980** | 5k–9k | 贴上限 |
| ruin-tower | 15,362 | **15,754** | 10k–16k | 窗洞/崩口 |
| ruin-idol | 3,872 | **4,864** | 2.5k–5k | 可读五官 |
| ruin-column | 2,714 | **3,986** | 2k–4k | 14 条凹槽 |
| shore-rocks | 6,746 | **6,746** | 3k–7k | tile×2.6/湿带 |
| jetty | 8,820 | **9,000** | 5k–9k | 贴上限 |
| dugout-canoe | 3,768 | **3,960** | 2k–4k | 接缝/桨架 |
| driftwood | 2,298 | **2,174** | 1.2k–2.5k | 盐蚀渐变 |
| wreck-boat | 5,264 | **5,794** | 5k–9k | 舱内网团/破洞 |

地图实际三角形（pass-2，`island-01` high）：jungle-tree **472,932**（63 棵，7,507/棵）、
coconut-palm 120,760（20 棵）、vine-drape 27,990（30 个）；树木总计比 pass-1 少约 **14.9 万**，
为下层植被加密腾出预算。其余地图数值见 QA 报告。

### 11.3 待办（pass-2 未做）

- `ISLAND_ASSETS.md §10.5` 的 P2 项：ground 贴图 4 m tile 重复感、复用沙漠道具（箱/桶）沉浸感、
  `mossStone` 苔藓覆盖偏高 → 需要纹理侧或地图道具侧的单独立项。
- 4 个结构模型贴预算上限（ruin-arch / jetty / bamboo-fence / spirit-totem），再加细节先砍。

