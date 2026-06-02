# Movements 惯性阻尼 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 C 引擎层 `src/modules/movements.c` 中实现触摸 pan 松手后的指数衰减惯性滑行，仅针对手机/pad WebView 嵌入场景。

**Architecture:** 在 `movements_t` 中保存 yaw/pitch 角速度与采样基线；`on_pan` 每帧记录位置和时间用于估算速度，`GESTURE_END` 时按条件启动惯性；`movements_update` 每帧推进 yaw/pitch 并指数衰减速度，开头先检查 lock/动画状态做让位；`on_pinch` 在 `GESTURE_BEGIN` 清零惯性。

**Tech Stack:** C (gnu11)、Emscripten/WebGL、stellarium 自有 obj_t 模块系统。无 C 单测框架，验证靠 `make js` 编译 + 设备手动测试。

**前置参考:** `docs/superpowers/specs/2026-05-28-movements-inertia-design.md`

---

## 文件结构

唯一改动文件：`src/modules/movements.c`。

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `src/modules/movements.c` | 触摸/鼠标/键盘的全部交互逻辑 | 修改：扩 struct、改 on_pan、改 on_pinch、扩 movements_update |

不动 `gesture.{c,h}`、不动 `navigation.c`、不动 JS/前端。

---

## 关于 TDD 与验证

本项目 C 层无单测框架（仅 `src/tests.c` 在 debug build 下跑少量自检），且本特性高度依赖渲染帧循环和真实输入设备，无法用单元测试覆盖。**每个 task 的验证手段是：编译通过 + 启动 dev server + 设备/模拟器手动验证**。下文每个 task 给出具体的验证脚本和预期现象。

构建命令统一用：
- `make js-debug`（C 层 debug 构建）
- `cd apps/web-frontend && make update-engine-debug`（把 debug engine 复制进前端）
- `cd apps/web-frontend && make dev`（启动 dev server，访问 http://localhost:8080）

---

## Task 1: 扩展 movements_t 结构 + 常量

**Files:**
- Modify: `src/modules/movements.c:17-22`

- [ ] **Step 1: 在文件顶部 include 后添加惯性常量**

在 `#include "swe.h"` 之后，`typedef struct movements` 之前插入：

```c
/* —— 惯性阻尼参数 —— */
#define INERTIA_DAMP_K          4.0    /* 衰减常数 (1/s) */
#define INERTIA_START_EPS_RATIO 0.1    /* 启动阈值相对 fov 的系数 */
#define INERTIA_STOP_EPS_RATIO  0.005  /* 停止阈值相对 fov 的系数 */
#define INERTIA_MAX_SAMPLE_DT   0.15   /* 速度采样最大间隔 (秒) */
```

- [ ] **Step 2: 扩 movements_t 结构**

替换原有 `typedef struct movements { ... } movements_t;` 为：

```c
typedef struct movements {
    obj_t           obj;
    gesture_t       gest_pan;
    gesture_t       gest_click;
    gesture_t       gest_pinch;

    /* —— 惯性阻尼状态 —— */
    bool            inertia_active;     /* 是否正在自动滑行 */
    double          velocity_yaw;       /* rad/s */
    double          velocity_pitch;     /* rad/s */
    /* 速度采样：on_pan 每帧更新 */
    double          last_yaw;
    double          last_pitch;
    double          last_pan_time;      /* core->clock，秒 */
} movements_t;
```

- [ ] **Step 3: 编译验证**

```bash
source $PATH_TO_EMSDK/emsdk_env.sh   # 已 source 的可跳过
make js-debug
```

Expected: 编译通过，无 warning（`-Werror` 下任何 warning 都会失败）。`build/stellarium-web-engine.{js,wasm}` 时间戳更新。

- [ ] **Step 4: 提交**

```bash
git add src/modules/movements.c
git commit -m "$(cat <<'EOF'
movements 增加惯性阻尼状态字段

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: on_pan 中加入速度采样（不启动惯性）

**Files:**
- Modify: `src/modules/movements.c:37-61`（整个 `on_pan` 函数）

本 task 只**采样并记录** last_yaw / last_pitch / last_pan_time 和 velocity_*，不在 update 中使用，方便单独验证逻辑不影响现有行为。

- [ ] **Step 1: 改写 on_pan 函数**

把现有 `on_pan` 整体替换为：

```c
static int on_pan(const gesture_t *gest, void *user)
{
    movements_t *movs = user;
    double sal, saz, dal, daz;
    double pos[3];
    static double start_pos[3];
    projection_t proj;
    double now, sample_dt;

    core_get_proj(&proj);
    screen_to_mount(core->observer, &proj, gest->pos, pos);
    if (gest->state == GESTURE_BEGIN)
        vec3_copy(pos, start_pos);

    vec3_to_sphe(start_pos, &saz, &sal);
    vec3_to_sphe(pos, &daz, &dal);
    core->observer->yaw += (saz - daz);
    core->observer->pitch += (sal - dal);
    core->observer->pitch = clamp(core->observer->pitch, -M_PI / 2, +M_PI / 2);

    obj_set_attr(&core->obj, "lock", NULL);
    observer_update(core->observer, true);

    /* —— 速度采样 —— */
    now = core->clock;
    if (gest->state == GESTURE_BEGIN) {
        /* 新 pan 开始：清惯性、重置采样基线 */
        movs->inertia_active = false;
        movs->velocity_yaw = 0;
        movs->velocity_pitch = 0;
        movs->last_yaw = core->observer->yaw;
        movs->last_pitch = core->observer->pitch;
        movs->last_pan_time = now;
    } else {
        /* UPDATE 或 END：估算瞬时角速度 */
        sample_dt = now - movs->last_pan_time;
        if (sample_dt > 1e-4 && sample_dt < INERTIA_MAX_SAMPLE_DT) {
            movs->velocity_yaw =
                (core->observer->yaw   - movs->last_yaw)   / sample_dt;
            movs->velocity_pitch =
                (core->observer->pitch - movs->last_pitch) / sample_dt;
        } else {
            movs->velocity_yaw = 0;
            movs->velocity_pitch = 0;
        }
        movs->last_yaw = core->observer->yaw;
        movs->last_pitch = core->observer->pitch;
        movs->last_pan_time = now;
    }

    /* Notify the changes. */
    module_changed(&core->observer->obj, "pitch");
    module_changed(&core->observer->obj, "yaw");
    return 0;
}
```

注意：
- 参数 `void *user` 在原代码里没用，现在用作 `movements_t*`。`movements_on_mouse` 已经在调用时传 `movs` 作 user（`gesture_on_mouse(3, gs, id, state, x, y, movs);`），可直接取用。
- 不要删除原有的 `static double start_pos[3];`，pan 的位置控制逻辑不变。
- 速度采样必须在 `yaw += (saz - daz)` 之后，这样取到的是更新后的 yaw。

- [ ] **Step 2: 编译验证**

```bash
make js-debug
```

Expected: 编译通过。

- [ ] **Step 3: 设备 smoke test（行为应与改动前一致）**

```bash
cd apps/web-frontend
make update-engine-debug
make dev
```

在手机/模拟器访问 http://<dev-machine-ip>:8080，做 pan 操作。

Expected: **行为与改动前完全一致**——pan 松手立即停。本 task 只采样、不消费速度。

- [ ] **Step 4: 提交**

```bash
git add src/modules/movements.c
git commit -m "$(cat <<'EOF'
movements on_pan 增加惯性速度采样

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: on_pan GESTURE_END 决定是否启动惯性

**Files:**
- Modify: `src/modules/movements.c`，`on_pan` 函数末尾（在 module_changed 调用之前插入）

- [ ] **Step 1: 在 on_pan 末尾增加启动判定**

定位到 Task 2 改造后的 `on_pan` 函数，在 `/* Notify the changes. */` 注释**之前**插入：

```c
    /* —— GESTURE_END 时决定是否启动惯性 —— */
    if (gest->state == GESTURE_END) {
        double v2 = movs->velocity_yaw * movs->velocity_yaw +
                    movs->velocity_pitch * movs->velocity_pitch;
        double start_eps = INERTIA_START_EPS_RATIO * core->fov;
        bool second_finger = core->inputs.touches[1].id != 0;
        if (v2 > start_eps * start_eps && !second_finger) {
            movs->inertia_active = true;
        } else {
            movs->inertia_active = false;
            movs->velocity_yaw = 0;
            movs->velocity_pitch = 0;
        }
    }
```

不启动惯性的两种情况都覆盖了：
- `v2 <= start_eps²`：松手速度太小
- `second_finger`：第二指仍在屏幕上（pan→pinch 过渡）

- [ ] **Step 2: 编译验证**

```bash
make js-debug
```

Expected: 编译通过。

- [ ] **Step 3: 设备 smoke test**

```bash
cd apps/web-frontend && make update-engine-debug && make dev
```

Expected: pan 松手后画面仍**立即停止**（因为 Task 4 才实现 update 推进）。但 `movs->inertia_active` 已被正确置位，不会引起任何视觉变化。

- [ ] **Step 4: 提交**

```bash
git add src/modules/movements.c
git commit -m "$(cat <<'EOF'
movements GESTURE_END 时按速度阈值启用惯性标志

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: movements_update 实现惯性推进 + 守卫

**Files:**
- Modify: `src/modules/movements.c:177-195`（整个 `movements_update` 函数）

这是核心 task，惯性效果在此 task 后会真正可见。

- [ ] **Step 1: 改写 movements_update**

把整个 `movements_update` 替换为：

```c
static int movements_update(obj_t *obj, double dt)
{
    movements_t *movs = (void*)obj;
    const double ZOOM_FACTOR = 1.05;
    const double MOVE_SPEED  = 1 * DD2R;

    /* —— 惯性阻尼推进 —— */
    if (movs->inertia_active) {
        /* 退出守卫：lock 或动画时让位 */
        if (core->target.lock || core->target.src_time != 0) {
            movs->inertia_active = false;
            movs->velocity_yaw = 0;
            movs->velocity_pitch = 0;
        } else {
            double decay;
            double stop_eps = INERTIA_STOP_EPS_RATIO * core->fov;

            /* a. yaw / pitch 推进 */
            core->observer->yaw   += movs->velocity_yaw   * dt;
            core->observer->pitch += movs->velocity_pitch * dt;

            /* b. pitch clamp，撞顶/底清零对应轴 */
            if (core->observer->pitch >  M_PI / 2) {
                core->observer->pitch =  M_PI / 2;
                movs->velocity_pitch = 0;
            }
            if (core->observer->pitch < -M_PI / 2) {
                core->observer->pitch = -M_PI / 2;
                movs->velocity_pitch = 0;
            }

            /* c. 指数衰减 */
            decay = exp(-INERTIA_DAMP_K * dt);
            movs->velocity_yaw   *= decay;
            movs->velocity_pitch *= decay;

            /* d. 低于阈值停止 */
            if (fabs(movs->velocity_yaw)   < stop_eps &&
                fabs(movs->velocity_pitch) < stop_eps) {
                movs->inertia_active = false;
                movs->velocity_yaw = 0;
                movs->velocity_pitch = 0;
            }

            /* e. 通知变更 */
            module_changed(&core->observer->obj, "yaw");
            module_changed(&core->observer->obj, "pitch");
        }
    }

    /* —— 原有键盘逻辑（PC 端，非本次目标但保留） —— */
    if (core->inputs.keys[KEY_RIGHT])
        core->observer->yaw += MOVE_SPEED * core->fov;
    if (core->inputs.keys[KEY_LEFT])
        core->observer->yaw -= MOVE_SPEED * core->fov;
    if (core->inputs.keys[KEY_UP])
        core->observer->pitch += MOVE_SPEED * core->fov;
    if (core->inputs.keys[KEY_DOWN])
        core->observer->pitch -= MOVE_SPEED * core->fov;
    if (core->inputs.keys[KEY_PAGE_UP])
        core->fov /= ZOOM_FACTOR;
    if (core->inputs.keys[KEY_PAGE_DOWN])
        core->fov *= ZOOM_FACTOR;
    return 0;
}
```

- [ ] **Step 2: 编译验证**

```bash
make js-debug
```

Expected: 编译通过。`fabs` 和 `exp` 来自 `math.h`，需要确认 `swe.h` 已经间接 include 了 `math.h`（项目其它模块用了 fabs/exp，正常应该有）。如果报 implicit declaration，在 movements.c 顶部加 `#include <math.h>`。

- [ ] **Step 3: 设备核心场景验证**

```bash
cd apps/web-frontend && make update-engine-debug && make dev
```

手机/模拟器测试以下场景，每条都应符合预期：

| 操作 | 预期 |
|---|---|
| 快速 pan 后松手 | 画面继续滑行约 0.5~1.5 秒后平滑停止 |
| 慢速 pan 后松手 | **不**滑行，立即停 |
| pan→手指停住→松手 | **不**滑行，立即停 |
| 惯性中再次点下 | 立即停（下一次 pan 的 BEGIN 清零） |
| 惯性中向天顶快速 pan 撞顶 | pitch velocity 立即归零，yaw velocity 继续衰减 |
| 点击锁定天体后 pan | pan 解锁 + 松手有惯性 |
| 惯性中点击锁定其它天体 | 惯性立即让位 lock（守卫触发） |

如果任一不符合，回头检查相关代码段，不要继续 commit。

- [ ] **Step 4: 提交**

```bash
git add src/modules/movements.c
git commit -m "$(cat <<'EOF'
movements_update 实现惯性推进与 lock 让位

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: on_pinch 中断惯性

**Files:**
- Modify: `src/modules/movements.c:80-93`（整个 `on_pinch` 函数）

- [ ] **Step 1: 改写 on_pinch 在 BEGIN 时清惯性**

把整个 `on_pinch` 替换为：

```c
static int on_pinch(const gesture_t *gest, void *user)
{
    movements_t *movs = user;
    static double start_fov = 0;
    projection_t proj;
    if (gest->state == GESTURE_BEGIN) {
        start_fov = core->fov;
        /* pinch 开始：清零正在进行的惯性 */
        movs->inertia_active = false;
        movs->velocity_yaw = 0;
        movs->velocity_pitch = 0;
    }
    core->fov = start_fov / gest->pinch;
    core_get_proj(&proj);
    core->fov = clamp(core->fov, proj.klass->min_ui_fov ?: CORE_MIN_FOV,
                      proj.klass->max_ui_fov);
    module_changed((obj_t*)core, "fov");
    return 0;
}
```

- [ ] **Step 2: 编译验证**

```bash
make js-debug
```

Expected: 编译通过。

- [ ] **Step 3: 设备验证 pinch 中断**

```bash
cd apps/web-frontend && make update-engine-debug && make dev
```

| 操作 | 预期 |
|---|---|
| 快速 pan 启动惯性 → 立即双指 pinch | 惯性立即停，pinch 缩放正常 |
| 双指同时落下做 pinch（无前置 pan） | pinch 正常工作，惯性始终为 inactive |

- [ ] **Step 4: 提交**

```bash
git add src/modules/movements.c
git commit -m "$(cat <<'EOF'
on_pinch 开始时中断惯性

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 全量回归 + release build 验证

**Files:** 无修改，纯验证。

- [ ] **Step 1: release build 确认无警告**

```bash
make js
```

Expected: 编译通过，无 warning。release 模式比 debug 模式更严格地优化，确认无 -Werror 触发。

- [ ] **Step 2: 前端 release 构建**

```bash
cd apps/web-frontend
make update-engine
make build
make start    # 本地 http server
```

Expected: 构建产物 `apps/web-frontend/dist/` 生成，访问 http://localhost:8080 能正常加载。

- [ ] **Step 3: 完整测试矩阵**

回到 spec 的测试计划，逐条执行：

- [ ] 手机：快速 pan 后松手，画面继续滑行约 1 秒后平滑停止
- [ ] 手机：慢速 pan 后松手，不应有惯性
- [ ] 手机：pan→停住手指→松手，不应有惯性
- [ ] 手机：惯性进行中再次点下，立即停止
- [ ] 手机：双指 pinch 起点（pan→pinch），不应有惯性
- [ ] 手机/pad：惯性中双指 pinch，pinch 开始立即停止惯性
- [ ] 手机：选中天体 lock 后 pan 解锁、产生惯性正常；再次锁定其它天体惯性立即让位
- [ ] 手机：向天顶/天底快速 pan 并松手，撞 ±π/2 时对应轴 velocity 清零
- [ ] pad：横竖屏切换后手感一致
- [ ] PC 端鼠标拖动也会触发惯性（pan 路径相同），手感至少不比改动前差

任一不通过则回到对应 task 修复。

- [ ] **Step 4: 提交（如有微调）**

如果验证中没有任何代码改动，跳过 commit。若有微调（如 `INERTIA_DAMP_K` 调整），单独 commit：

```bash
git add src/modules/movements.c
git commit -m "$(cat <<'EOF'
惯性参数微调

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 实现完成后

- [ ] 在分支 `movements` 上推送，由用户决定合并策略
- [ ] 如默认参数手感欠佳，按 spec 第 12 节方向继续调
