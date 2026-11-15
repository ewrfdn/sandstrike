# DEV TOOLS // SERVER (预留)

**当前为空**：本目录只有设计说明，没有可运行代码。未来「编辑」能力（在地图里选中 / 移动 / 放置物体并保存回地图 JSON）会通过这里的本地服务提供给 `dev_tools/ui/`。

## 为什么需要它

查看器（`dev_tools/ui/`）是纯前端、只读的：它 import 游戏的真实模块把地图跑起来看。真正要**改**地图（拖动物体、增删道具、保存 `src/config/maps/<id>/*.json`）时，浏览器不能直接写仓库文件，需要一个小型的本地写盘服务 —— 这就是 `server/` 的职责。

## 计划中的边界（实现时以此为准）

- 只监听 `127.0.0.1`，仅开发期使用；绝不随发行包发布、不做公网鉴权。
- HTTP + JSON API，由 `npm run dev:tools` 一并启动（或单独 `dev_tools/server` 进程，UI 通过 Vite proxy 访问）。
- 读写范围严格限制在 `src/config/maps/`（及未来的 `src/config/`）内，路径规范化后必须仍落在仓库目录里。
- 典型接口（示意，未实现）：
  - `GET  /api/maps`                      地图清单（复用 `src/config/maps/index.js` 语义）
  - `GET  /api/maps/:id`                  读取并规范化一张地图（复用 `src/world/data/index.js`）
  - `PUT  /api/maps/:id`                  校验（`validateMapData`）后写回 map.json / 各 part JSON
  - `POST /api/maps/:id/validate`         只校验不落盘，返回错误列表
  - `POST /api/preview`                   请求 UI 重新加载某张地图 / 某个模型
- 所有写入必须先过 `src/world/data/` 的 schema 校验与格式化（保持 JSON 缩进 / 键顺序稳定，便于 diff）。
- server 不碰渲染：Three.js 仍跑在浏览器里，server 只做文件与校验。

## 待办

- [ ] 选定 server 运行时（Node 内置 `http` 即可，避免额外依赖）
- [ ] 地图读写 + 校验 API
- [ ] Vite proxy 接线（`/api` → server）
- [ ] UI 侧编辑态的撤销 / 重做与保存确认
