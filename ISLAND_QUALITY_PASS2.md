# island-01 资产质量第二轮打磨（pass-2）交付说明

> 目标：回应"小岛上的模型很多还有瑕疵，树木的细节不够"，同时**借鉴 `D:\dev\demo\golden-temple`（下称 GT，
> 离线渲染项目）的高精度植被生成技术**，并守住本项目的实时性能预算。
> 交付时点：2026-11-14 · 工作树未提交 git · 证据目录 `.scratch/island-pass2/`
>
> 结论：**25/25 模型全部重做/打磨完成，树木体系按 GT 技术路线重建**；独立 QA 判定 **SHIP（无 P0 阻塞）**：
> 单帧三角形最差 1.005× 基线（medium 档反而 -6%），raw render 持平（jetty -45%），
> draw call 172→218（含阴影 pass，叶片材质桶翻倍所致，属已接受偏差）；
> `island-01` 四档画质全部可启动、零 console error；`outpost-07` 沙漠地图零回归；单文件包已重建并通过独立校验。
> 遗留问题见 §6。

---

## 1. 问题是什么（pass-1 的真实状态）

`island-audit` 对 25 个模型逐一做四视图 + 12 张游戏内机位 + 8 张玩家视高特写（45 张全部目检），
结论是"数值 25/25 PASS ≠ 看起来像真的"。最严重的 7 类（完整清单见 `.scratch/island-pass2/audit-pass2.md`）：

| # | 现象 | 证据 |
| --- | --- | --- |
| 1 | **树冠是"叶柱"不是伞冠**：14.06 m 高 / 8.78 m 冠幅，叶团只集中在半径 2.5–3.3 m，15 m 外像白杨/蜡烛 | `before/closeups/02-jungle-canopy-15m.jpg` |
| 2 | **单张巨叶 0.54–1.42 m**（真实雨林叶 0.15–0.35 m），仰视能数清叶子 | `before/closeups/01-jungle-canopy-5m.jpg` |
| 3 | **9 类植被零变体**：63 棵树只有 41 个不同 yaw，纯单几何克隆 | `before/hero/05-tower.jpg` |
| 4 | **30 个 vine-drape 全部悬空**（没有挂点高度，读作"晾衣架/晾衣绳"） | `before/hero/11-temple-gate.jpg` |
| 5 | **竹丛 15 m 外是"无叶竹竿"**，却是画面里最高的植被之一（5.95 m） | `before/hero/09-heart-clearing.jpg` |
| 6 | **遗迹石材黑白棋盘/乐高砖**（混用两套完全不同的石贴图） | `before/closeups/08-ruins-closeup.jpg` |
| 7 | **地被"深绿噪声 + 纸扇"**：地面是玩家 63% 的画面，却是 200 个草簇 + 一张噪声贴图 | `before/closeups/04-understory-ground.jpg` |

## 2. 从 golden-temple 借鉴了什么、怎么实时化

GT 是纯代码程序化电影项目（约 31k 行、2400 万三角形、离线 8 子帧渲染）。只借**生成思路与图集技术**，
不借任何逐帧成本。逐项对照（完整拆解见 `.scratch/island-pass2/gt-techniques.md`）：

| GT 技术 | GT 里的成本 | island-01 的实时化做法 | 落地位置 |
| --- | --- | --- | --- |
| **叶片簇卡（sprig / spray）**：一张 alpha 卡 = 一根小枝带 6–18 片小叶，替代"一片叶一张卡" | 每卡 2 tris，但总卡数大 | 新图集 `lib.canopy`（1024² 4 格）+ 每棵树 2,600–3,000 张卡；**单叶有效尺寸 0.1–0.2 m**（原来 0.5–1.4 m），密度上去而三角形不涨 | `src/textures/canopy.js`、`leaf-atlas.js` `canopyQuad()` |
| **`growCurve` + `fitInEnvelope` + `shellFill`**：在椭球包络里长骨架、冠层外壳补叶子 | 离线生成，ms 级/棵 | 移植为 `src/models/world/island/tree/{rng-noise,skeleton,species,meshers,variants,build-variant}.js`：骨架 + 冠层椭球外壳填充 + 天窗噪声；构建期一次生成、4 套变体共享材质 | `tree/skeleton.js`、`tree/meshers.js` |
| **逐叶顶点属性打包**（颜色/风权重/相位） | 每叶一段属性 | 只用 3 通道打包进 `color`：`r=AO`、`g=风摆权重`、`b=色相抖动`（`mergeGeometries` 只保留标准属性，所以必须走 color） | `tree/meshers.js` + `foliage-fx.js` |
| **风摆 / 逆光透光 / 阴影同步** | 每帧 CPU 摆 | 全部塞进 GPU `onBeforeCompile`：世界空间位移（振幅随世界 Y 增大）+ `<lights_fragment_end>` 逆光项 + `customDepthMaterial`（阴影跟着摆，不需要 CPU 重算） | `src/world/foliage-fx.js` |
| **多物种/多变体** | 每个变体单独资产 | `jungle-tree` 4 变体（骨架参数不同、共享图集与材质）、椰树 2、垂藤 2；按画质档 4/3/2/1 | `tree/variants.js`、各模型 `buildWorld()` |
| **树皮环网格 + 板根 + 附生植物** | 高模 | 环状树皮网格（UV tile 1.35 m，原 2.5 m 太粗）+ 4–6 片板根 + 附生床/垂藤，**地图 LOD 单棵 ≈7,500 tris** | `tree/meshers.js`、`tree/species.js` |

**没有借鉴的**（GT 里成本过高或与本项目风格冲突）：体积云、逐叶次表面散射 LUT、每帧实例化重排、
2400 万面级别的冠层填充、离线 8 子帧累积。理由写在 `gt-techniques.md §6`。

同时补了两个**GT 没有、但本项目缺的**东西：
- `lib.grassBlade` 草簇图集（一张卡 = 一整簇 15–24 片草叶），把"深绿噪声+纸扇"的地面换成有轮廓的草；
- `M.canopy*` / `M.ruinStoneDark` 等材质变体，解决"顶点色材质在实机被批处理清零/石材混用"的接线问题。

## 3. 改了什么（按模型）

（详见 `.scratch/island-pass2/{flora-canopy,understory,structures}-report.md` 与 QA 报告）

### 3.1 树木（F1/F2/F7）
- `jungle-tree`：全新程序化生成（骨架/冠层外壳/叶簇卡/打包顶点色），4 变体，stage 14,666 tris / map 7,441 tris ×63 棵；
- `coconut-palm`：2 变体，真实几何环带替代伪造 V 形环痕，冠部 14–18 片下垂叶 + 椰果簇，7,914 tris；
- `vine-drape`：2 变体、顶部改为 2 段断枝嵌冠、主藤加粗、气生根，1,664 tris；**布局 30 例全部加挂点高度并重新坐到乔木冠缘**。

### 3.2 下层植被（F3–F6/F8/F9）
bamboo 4,572 / bush 1,756 / fern 2,362 / banana 3,736 / fallen-log 3,312 / grass-tuft 1,156 tris；
全部改用叶簇卡/草簇卡分层；修掉"无叶竹竿""纸片地被""等距蘑菇""木币根盘"等 pass-1 P1。

### 3.3 建筑与海岸（V1–V6/R1–R5/S1–S5）
- 遗迹石材统一到火山岩贴图两档（`ruinStone` + `ruinStoneDark`），逐块 UV 偏移/倒角/尺寸抖动，修掉黑白棋盘；
- `ruin-idol` 刻出可读的脸（眼窝/眉脊/鼻/嘴）；`ruin-column` 14 条凹槽；`ruin-tower` 窗洞/崩口/藤蔓；
- 村：茅草檐口/屋脊散草、破屋焦梁+藤叶串、竹篱端点吸附、晾晒架改海带/鱼/编织筐、栈道斜撑吸附、图腾背面浮雕；
- 岸：礁石 UV tile ×2.6 + 湿带、浮木盐蚀渐变、沉船舱内网团/油桶/破洞、栈桥逐板 UV、独木舟接缝/桨架；
- 顺带修掉一个**全项目级 bug**：`vertexColors:true` 材质在静态批合并后没有 color 属性 → 实机遗迹/漂木全黑；
  `bakeVertexAO()` 现在改为**乘法**融合已有顶点色（舞台里手工调好的逐块明暗/湿带在实机也生效）。

## 4. 性能（QA `perf-compare.md`：medium/high × 4 机位 × 4 轮，headless D3D11）

| 指标 | pass-1 基线 | pass-2 | 判定 |
| --- | --- | --- | --- |
| 单帧三角形（最差格） | 3,201,977（medium/high spawn） | 最差 3,216,605（high spawn，**1.005×**） | PASS（阈值 ≤1.05×） |
| medium 三角形 | 3,201,977 / 3,151,293 / 2,848,713 | **-5.9% ~ -9.8%**（全域下降） | PASS |
| draw calls | 172 / 163 / 138 | 218 / 208 / 180（**+33 ~ +50**，含阴影 pass） | 接受（2 倍材质桶；仍远低于桌面预算） |
| raw render ms | spawn 1.82 / village 5.27 / temple 4.36 / jetty 6.33（medium） | 2.29 / 4.46 / 3.57 / 3.50（jetty **-45%**，spawn +0.5 ms） | PASS（绝对增量 <1 ms） |
| lowest LOD | 1,622,057 tris / 97 calls | **1,299,381 tris（-19.9%）** / 110 calls | PASS（LOD 真正生效） |
| low LOD | 3,201,977 / 172 | **2,757,677（-13.9%）** / 208 | PASS |
| 树冠 5 m 近景（postfx ON，high） | — | raw 2.32 ms + 合成 6.06 ms/帧（p95 7.7）≈ 165 fps 提交上限 | PASS |

> **postFx 单帧成本在 headless 里噪声极大**（基线自身同一格 2 轮就能 3.2→25.4 ms，8×），
> QA 判定不可作为回归依据；需要真机复核一轮。raw render（几何/材质真实成本）没有恶化，
> 且三角形总量在 medium 档反而下降。

**性能护栏结论**：新增成本全部在静态实例/draw call 与 GPU 侧 shader（风摆/透光），
每帧没有新增 CPU 逻辑；三角形总量持平（最差 +0.5%），raw render 持平略好，低画质档真正降级。预算内 SHIP。

## 5. 验收证据与结论

**独立 QA（`qa-verifier`，不修改产品代码）结论：SHIP，无 P0 阻塞。**

- **数值**：25/25 模型在预算内、25/25 `minY ∈ [-0.05, 0.05]`、`missingMaterials=[]`、console error 0；
  9 个模型贴预算上限（jetty 100%、ruin-arch 99.8%、bamboo-fence/spirit-totem 99% 等），加细节前需先腾面数。
- **视觉（逐张目检 12 英雄机位 + 8 特写 + 低画质 24 张 + 25 张 stage）**：审计 P0 全部确认修复；
  5 m 仰视从"可数巨叶 + 50% 天空孔洞"变成"叶簇密铺 + 枝干可见 + ~22% 孔洞"；
  15 m 从"白杨叶柱 + 同形克隆"变成"伞冠 + 4/3/2/1 档变体"；
  藤帘悬空、棋盘石、龟壳岩、无叶竹、纸扇草全部消除；lowest/low 画质仍可读且三角形分别 -19.9%/-13.9%。
- **回归**：`node scripts/check.mjs`、`npm run check:maps` exit 0；lowest/low/medium/high 四档启动
  `loaded:true`、0 error；`outpost-07` 与既有 baseline **PASS 0 fail / 0 warn**（三角形/碰撞完全相同，
  像素 mean 0–0.24%，自检 0.0000%）；单文件 `sandstrike.html` 已重建 + verify-standalone（0 error，15 波通关）。
- 证据目录：`.scratch/island-pass2/qa-pass2/`（`qa-report-pass2.md`、`numeric.json`、`perf-after.json`、
  `perf-compare.md`、`hero/`、`closeups/`、`hero-lowest/`、`hero-low/`、`stage/`、`montage-1/2/3.jpg`）。
- 拼图：`montage-1-tree-canopy.jpg`（树冠 5m/15m）、`montage-2-understory.jpg`（地被）、
  `montage-3-structure.jpg`（遗迹/村落/海岸）。

### 5.1 验收过程中澄清的一个"疑似 bug"

首轮 hero/10 右下大片漂白被怀疑是资产问题。QA 用 no-postfx 对照发现是**敌人激光曳光弹 + high bloom(0.4)**
的瞬时特效被截帧（干净重拍后近白像素 0.0%），归档在 `qa-pass2/artifacts/`，不是模型回归。
建议后续把 bloom mip 降一档或给曳光弹 clamp（P2）。

## 6. 遗留问题（不阻塞当前交付）

**P1（发布前建议处理）**
1. 单文件 `sandstrike.html` 属发布清单：本轮已重建 + `verify-standalone` 通过，之后任何 src 改动都要重跑
   `node scripts/build-standalone.mjs && node scripts/verify-standalone.mjs`；
2. postFx 单帧成本在 headless 中不可靠（全屏合成 + 基线自抖 8×），建议真机采样复核一次；
3. 9 个模型贴预算上限，再加细节前先腾面数。

**P2（已知，属后续独立立项）**
- 高画质 bloom 对曳光弹/太阳高光过曝；逆光叶卡近景有"半透明重影"；个别树冠有裸枝梢穿出；
- 遗迹岩缝仍有规则横线/细亮线（比 pass-1 大幅收敛）；
- 复用沙漠道具（`SANDSTRIKE 7.62×51` 木箱、橙油桶）仍出现在岛村 —— 沉浸感问题，需要地图道具侧处理；
- ground 贴图 4 m tile 重复感、`mossStone` 苔藓覆盖偏高（纹理侧）；
- 低画质 lowest 只保留 1 个树变体 + 19% 叶卡，远景会明显稀疏（移动端取向，可接受）。
