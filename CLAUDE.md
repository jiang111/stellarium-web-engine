# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库总览

这是 **Stellarium Web Engine** 的一个 fork：一个用 C 写成、通过 emscripten 编译为 WebGL/WASM 的 JavaScript 行星馆渲染引擎。包含一个 Vue.js 前端 GUI 和示例页面，部分内容针对中文/移动 App 嵌入场景做了定制（参见 `apps/web-frontend/USAGE.md` 的 JSBridge 协议）。

顶层结构：

- `src/` — C 引擎源码
- `ext_src/` — 第三方 C 库（erfa、webp、nanovg、zlib 等），不要修改
- `apps/web-frontend/` — Vue 2 + Vuetify 的 GUI，使用 Docker 开发
- `apps/simple-html/` — 不依赖构建工具的最小 HTML 示例
- `apps/skydata/` — 星表/DSO/星座/地景等运行时数据（HTTP 加载），dev 与生产共用同一份
- `tools/` — 构建辅助 Python 脚本（资产打包、星表预处理等）
- `doc/internals.md` — 引擎架构权威参考文档，开发引擎前必读

## 构建与运行

### 引擎（C → WASM）

构建依赖：emscripten + SCons。必须先 `source $PATH_TO_EMSDK/emsdk_env.sh`。

```bash
make js              # release 构建（Module 形式）
make js-debug        # debug：-O0、ASSERTIONS=1、SAFE_HEAP=1、含测试
make js-prof         # profiling 构建
make js-es6          # 生成 ES6 module（前端 Vue 项目用这个）
make js-es6-debug    # ES6 + debug
clean: scons -c
```

产物在 `build/stellarium-web-engine.{js,wasm}`。`SConstruct` 里写死了 `INITIAL_MEMORY=33554432`、`USE_WEBGL2=1`、`ALLOW_MEMORY_GROWTH=1`，并通过 `--pre-js` 注入 `src/js/{pre,obj,geojson,canvas}.js`。

**重要**：每次 SCons 构建前会自动运行 `./tools/make-assets.py`，它把 `data/` 下的资源打包成 `src/assets.inl`（被 `assets.c` include）。如果改动数据资源没生效，先确认这个脚本能跑通。

`werror=1` 默认开启，警告会被当作错误。需要临时绕过用 `scons werror=0`。

### Web 前端（Vue 2 + Vuetify）

`apps/web-frontend/` 完全在 Docker 里跑（节点版本和 emscripten 版本都被钉死）：

```bash
cd apps/web-frontend
make setup           # 构建两个 docker 镜像：swe-dev（C 编译）+ stellarium-web-dev（前端）；并 yarn install
make dev             # 启动 webpack dev server，http://localhost:8080
make build           # 生产构建到 dist/
make start           # python3 -m http.server 8080 在 dist/
make lint            # eslint
make update-engine   # 重新编译 ES6 引擎并复制到 src/assets/js/
make update-engine-debug
make i18n            # 提取国际化字符串
```

Docker 容器会把 `apps/skydata` 挂到 `/skydata`。

### Native 二进制（测试用）

`SConstruct` 同时会构建 `build/stellarium-web-engine`（native 可执行文件），主要用于 `make doc` 时生成 `--gen-doc` 输出，以及在 debug 模式跑 C 单元测试（`-DCOMPILE_TESTS`，由 `src/tests.c` 驱动）。没有专用的 `test` make target，调试模式跑可执行文件即可。

## 引擎架构（C 部分）

详见 `doc/internals.md`。核心概念：

### obj_t 单继承对象系统

所有引擎对象都派生自 `obj_t`（`src/obj.h`），通过把 `obj_t` 作为 struct 第一个字段实现"继承"（类 Linux kobj 模式）。每个类有一个 static 的 `obj_klass_t`（vtable + 元数据 + 属性列表），用 `OBJ_CREATE` 宏实例化。这是引擎所有动态行为的基础——不要绕过它直接用裸结构体。

派生层级（部分）：

```
obj_t
 ├─ core_t (src/core.c)         全局上下文，单例 `core`
 ├─ observer_t (src/observer.c)  观测者位置/时间
 ├─ module 实例 (src/modules/*)  stars / dso / planets / atmosphere / ...
 └─ 天体实例 (star、dso entry、planet、satellite ...)
```

`core` 是全局指针（`extern core_t *core`），承载 fov、tonemapper、observer、bortle_index 等渲染参数。

### Modules

`src/modules/*.c` 每个文件就是一个可注册的模块，通过文件末尾的 `MODULE_REGISTER` 宏在启动时自动挂到 core 下面。模块负责：

- 渲染一类天体/图层（stars、dso、planets、milkyway、atmosphere、landscape、constellations、lines、cardinal、satellites、comets、minorplanets、meteors、photos…）
- 处理交互（`movements.c` = 鼠标/键盘平移缩放，`drag_selection.c`、`pointer.c`）
- 系统功能（`labels.c` 标签布局、`debug.c`、`skycultures.c`、`coordinates.c`）

新增渲染层：在 `src/modules/` 新建 `.c`，定义 `obj_klass_t`，实现 `render`/`update`，用 `MODULE_REGISTER`。SCons glob 会自动包含。

### 属性 / Stack 调用约定

`obj_klass_t.attributes` 暴露的属性可以从 JS 通过 `obj.attr = ...` 访问。底层是 `obj_call(obj, "name", "签名串", ...)`，签名串描述输入/输出（`i`/`f`/`b`/`s`/`p`，可选 `>` 分隔出参）。这是 JS↔C 的桥梁，新增 JS 可见属性必须走这个机制。

### Painter / Projection / paint_quad

渲染走 `painter_t`（`src/painter.h`）+ `projection_t`（`src/projection.h`、`src/projections/*.c`：perspective / stereographic / mercator / hammer / mollweide）。坐标链：texture UV → 3D sphere → horizontal → observed → view → clipping，参见 `doc/internals.md` "Quad rendering"。

`paint_quad` 接受 UV 坐标 + 反投影函数，自动细分网格并处理投影不连续（如经度跨越）。`traverse_surface` 用于 HEALPix/HiPS 等层级 tile 数据。

### Algos

`src/algos/` 只能依赖 erfa（开源版 SOFA），不能依赖项目其他部分。包含 deltat、月球、土星环、moon、orbit、healpix、refraction 等。

### Assets

资源通过 `tools/make-assets.py` 编译进二进制（无文件系统：`FILESYSTEM=0`）。运行时 `asset_get_data("asset://...")` 读取；普通 URL 会走 HTTP/fetch。星表/星座/地景之类的"大数据"则放在外部 `apps/skydata/`，运行时通过 URL 加载。

## 前端架构（apps/web-frontend）

- Vue 2.6 + Vuetify 2.6 + Vuex + vue-router + vue-i18n + leaflet（位置选择）
- 引擎通过 `import StelWebEngine from './assets/js/stellarium-web-engine.js'` 加载（ES6 module 模式）
- `src/components/jsbridge.vue` + `jsbridge-selected-object.vue` 是与原生 App（iOS/Android WebView）通信的桥。可调用方法和数据契约见 `apps/web-frontend/USAGE.md`，**修改这两个文件等于改外部 API，要谨慎并同步文档**
- `src/store/index.js` Vuex store
- `src/plugins/` 是 yarn workspaces，独立子包

ESLint：`vue-cli-service lint`（standard 风格 + vuetify 插件 + Vue essential）。

## 数据目录（skydata）

`apps/skydata/` 含 `stars/`、`dso/`、`skycultures/`、`landscapes/`、`surveys/`、`mpcorb.dat`、`CometEls.txt`、`tle_satellite.jsonl.gz`。dev 容器（`Makefile` 挂载）和生产构建（`vue.config.js` 拷贝）都用这一份，已与原 `test-skydata` 整合为单一目录。

**当前分支的未跟踪文件**：`apps/skydata/skycultures/chinese/`——新增的中文星座文化数据，未提交。如果改 skyculture 相关代码记得验证该目录。

`.DS_Store` 在多处被 modified（macOS 生成），不要把它们提交进去。

## 项目特定约定

- C 代码风格：`-Wall -Werror -std=gnu11`，注意 `-Wno-initializer-overrides`（允许 designated init 覆盖）。提交前确保 `make js` 不报警告
- 不要修改 `ext_src/` 下任何文件
- 新增 .c 文件无需改 SConstruct，glob 模式会自动包含 `src/*.c*`、`src/algos/*.c`、`src/modules/*.c`、`src/projections/*.c`、`src/utils/*.c`
- 引擎日志用 `LOG_E / LOG_W / LOG_I / LOG_D`（`src/log.h`），不要直接 `printf`
- 引擎不依赖 libcurl（`-DNO_LIBCURL`），HTTP 请求在 emscripten 下走 `request_js.c`（fetch）
- 当前活跃分支：`movements`（围绕 `src/modules/movements.c` 的交互改造）；最近 commit 涉及 mythology、FOV 自适应缩放、天体升降轨迹时间刻度
- `.claude/skills/astronomy-fov-guide/` 含项目内 PA / Rotation / Polar / Parallactic Angle 的术语规范，做相机视场/旋转相关功能时先看一眼

## 文档

- `doc/internals.md` — 引擎架构（务必读）
- `apps/web-frontend/USAGE.md` — JSBridge API 协议（移动 App 嵌入用）
- `apps/web-frontend/README.md` — Docker 工作流
- `apps/simple-html/README.md` — 纯静态示例
