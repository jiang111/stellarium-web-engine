# Movements 模块惯性阻尼设计

- 日期：2026-05-28
- 分支：movements
- 范围：`src/modules/movements.c`（C 引擎层）
- 目标：让触摸拖动（pan）松手后产生指数衰减的惯性滑行，对齐原生移动端 App 的交互手感
- **适配范围：仅手机和 pad 的 WebView 嵌入场景**，PC 端（键盘、滚轮、鼠标）不在本次目标内

---

## 1. 背景

对比 Web Engine 与移动端 App 的交互差异，最显著的一点是：**原生端 pan 松手后画面会沿原方向继续滑动一段并自然衰减，Web Engine 是硬停**。本设计在 C 引擎层实现这一效果，不动 JS 层，对所有调用方透明生效。

> PC 端的键盘方向键、PgUp/PgDn、鼠标滚轮虽然在 `movements.c` 中也有处理，但不是本次目标的输入路径，下文不为它们设计专门的中断逻辑。

## 2. 触发范围

| 输入 | 是否带惯性 |
|---|---|
| 单指 pan（触摸拖动） | ✅ |
| 双指 pinch | ❌ |
| Tap / 双击 | ❌ |

仅单指 pan 触发；pinch 会**中断进行中的惯性**。

## 3. 衰减模型

指数衰减：

```
yaw   += velocity_yaw   * dt
pitch += velocity_pitch * dt
velocity_yaw   *= exp(-DAMP_K * dt)
velocity_pitch *= exp(-DAMP_K * dt)
```

当 `|velocity_yaw| < STOP_EPS` 且 `|velocity_pitch| < STOP_EPS` 时整体停止。

## 4. 数据结构

在 `movements_t` 增加状态字段：

```c
typedef struct movements {
    obj_t           obj;
    gesture_t       gest_pan;
    gesture_t       gest_click;
    gesture_t       gest_pinch;

    /* —— 惯性阻尼状态 —— */
    bool            inertia_active;     // 是否正在自动滑行
    double          velocity_yaw;       // rad / 秒
    double          velocity_pitch;     // rad / 秒
    /* 速度采样用：on_pan 每帧更新，用于在 GESTURE_END 估算 velocity */
    double          last_yaw;
    double          last_pitch;
    double          last_pan_time;      // core->clock 时间戳（秒）
} movements_t;
```

> 不再用 `(saz - daz) / dt` 作为速度源，而是直接取 `yaw / pitch` 帧间差除以时间差。
> 原因：方向符号自动正确，免去重新推理坐标系约定；且 yaw 是惯性最终要更新的量，源头一致更稳。

## 5. 调用时序与冲突处理

引擎一帧顺序（`core.c:289` `core_update`）：

```
core_update_observer(dt)
    ├─ core_update_fov(dt)
    ├─ core_update_time(dt)
    ├─ core_update_direction(dt)    ← lock 追踪、point-and-lock 动画在这里改 yaw/pitch
    └─ core_update_mount(dt)
tasks 循环
各 module.update(dt)                ← movements_update 在这里
渲染
```

惯性 update 在 `core_update_direction` 之后跑，会**覆盖 lock 和动画结果**。这是必须处理的核心冲突。

### 5.1 `movements_update` 开头的退出守卫

按顺序检查，任一条件成立即清零惯性并跳过本次推进：

```c
// 1. 有锁定天体：lock 追踪每帧把 yaw/pitch 设到目标位置，惯性不能覆盖
if (core->target.lock) movs->inertia_active = false;

// 2. 有移动动画（core_point_and_lock 之类）正在跑
if (core->target.src_time != 0) movs->inertia_active = false;
```

> PC 端键盘按键的冲突不在本次目标范围内，不做特殊处理。如果用户在 PC 端按方向键时刚好有惯性，两者会叠加，属于已知非目标场景。

### 5.2 其它入口的清零

| 入口 | 清零时机 |
|---|---|
| `on_pan` | `GESTURE_BEGIN` 时清零（用户重新按下=停惯性） |
| `on_pinch` | `GESTURE_BEGIN` 时清零（双指落下） |

## 6. 速度采样

### 6.1 在 `on_pan` 中

```c
double now = core->clock;
double yaw_now   = core->observer->yaw;
double pitch_now = core->observer->pitch;

if (gest->state == GESTURE_BEGIN) {
    // 清零惯性、初始化采样基线
    movs->inertia_active = false;
    movs->last_yaw   = yaw_now;
    movs->last_pitch = pitch_now;
    movs->last_pan_time = now;
} else {
    // UPDATE 或 END：基于上一次回调到现在的角度差估算速度
    double sample_dt = now - movs->last_pan_time;
    if (sample_dt > 1e-4 && sample_dt < MAX_SAMPLE_DT) {
        movs->velocity_yaw   = (yaw_now   - movs->last_yaw)   / sample_dt;
        movs->velocity_pitch = (pitch_now - movs->last_pitch) / sample_dt;
    } else {
        // 间隔太长（停顿后松手）或太短（同一帧多个事件），速度判 0
        movs->velocity_yaw = 0;
        movs->velocity_pitch = 0;
    }
    movs->last_yaw   = yaw_now;
    movs->last_pitch = pitch_now;
    movs->last_pan_time = now;
}
```

注意：取速度要在 `yaw += (saz - daz)` 等位移累加**之后**，这样 yaw_now 反映本次回调的最终位置。

### 6.2 启动惯性的条件（在 `GESTURE_END` 处理末尾）

```c
if (gest->state == GESTURE_END) {
    double v2 = sqr(movs->velocity_yaw) + sqr(movs->velocity_pitch);
    bool second_finger = core->inputs.touches[1].id != 0;
    if (v2 > sqr(START_EPS) && !second_finger) {
        movs->inertia_active = true;
    } else {
        movs->inertia_active = false;
        movs->velocity_yaw = 0;
        movs->velocity_pitch = 0;
    }
}
```

不启惯性的两个理由：
- 速度太小（用户慢速松手，防止微抖产生漂移）
- pan→pinch 过渡（第二指落下导致 pan 被强制 END，用户意图是 pinch 不是甩出去）

## 7. 推进逻辑（`movements_update` 主体）

```c
if (movs->inertia_active) {
    // a. yaw / pitch 推进
    core->observer->yaw   += movs->velocity_yaw   * dt;
    core->observer->pitch += movs->velocity_pitch * dt;

    // b. pitch clamp，撞顶/底清零对应轴
    if (core->observer->pitch >  M_PI / 2) {
        core->observer->pitch =  M_PI / 2;
        movs->velocity_pitch = 0;
    }
    if (core->observer->pitch < -M_PI / 2) {
        core->observer->pitch = -M_PI / 2;
        movs->velocity_pitch = 0;
    }

    // c. 指数衰减
    double decay = exp(-DAMP_K * dt);
    movs->velocity_yaw   *= decay;
    movs->velocity_pitch *= decay;

    // d. 低于阈值停止
    if (fabs(movs->velocity_yaw)   < STOP_EPS &&
        fabs(movs->velocity_pitch) < STOP_EPS) {
        movs->inertia_active = false;
        movs->velocity_yaw = 0;
        movs->velocity_pitch = 0;
    }

    // e. 通知变更
    module_changed(&core->observer->obj, "yaw");
    module_changed(&core->observer->obj, "pitch");
}
```

## 8. 关键参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `DAMP_K`        | `4.0` (1/s)               | 衰减常数，4.0 时约 0.6 秒衰减到 1/10，1.5 秒基本停。手感接近 iOS。 |
| `START_EPS`     | `0.1 * core->fov` rad/s   | 启动惯性的最小角速度。用 fov 缩放，避免 fov 大时仍嫌慢、fov 小时一动就飞。 |
| `STOP_EPS`      | `0.005 * core->fov` rad/s | 停止阈值。 |
| `MAX_SAMPLE_DT` | `0.15` 秒                  | 上一次 pan 回调到 END 超过此值则速度记 0（防止"停一会再抬手就飞出去"）。 |

所有 fov 缩放阈值在使用时读 `core->fov` 而不是缓存值，避免缩放变化后阈值过时。

## 9. 实现影响范围

| 文件 | 变更 |
|---|---|
| `src/modules/movements.c` | 主要修改：扩 struct、改 on_pan / on_pinch / on_zoom、扩 movements_update |
| 其它 | 无 |

不动 `gesture.{c,h}`、不动 JS 侧、不动 navigation.c。

## 10. Known Limitations（v1 不处理）

1. **外部 JS 直接改 yaw/pitch 不会打断惯性**。理论上 JS 通过 `obj_set_attr` 把 yaw 设到某个值，惯性下一帧又推走。需要在 attr setter 路径加 hook 才能解决，成本高。先观察是否真有此场景。
2. **惯性中 fov 自动跟随**（如 telescope_auto）变化时，阈值是动态算的，不存在过时问题；但若 fov 在惯性中剧烈变化（如外部代码设 fov），阈值会跟着跳，可能让惯性提前/延后结束。可接受。
3. **靠近天极的非线性畸变**：现有 on_pan 直接 yaw += (saz - daz) 在天极附近就有畸变，惯性继承这个问题，不引入新问题。

## 11. 测试计划

主要在手机/pad 的 WebView 嵌入场景中手动验证，无单元测试：

- [ ] 手机：快速 pan 后松手，画面继续滑行约 1 秒后平滑停止
- [ ] 手机：慢速 pan 后松手，**不应有惯性**（验证 START_EPS）
- [ ] 手机：pan→停住手指→松手，**不应有惯性**（验证 MAX_SAMPLE_DT）
- [ ] 手机：惯性进行中再次点下，**立即停止**
- [ ] 手机：双指 pinch 起点（pan→pinch），**不应有惯性**（pan END 时第二指仍在）
- [ ] 手机/pad：惯性中双指 pinch，pinch 开始**立即停止**惯性
- [ ] 手机：选中天体 lock 后 pan 解锁、产生惯性正常；再次点击锁定其它天体，**惯性立即让位** lock
- [ ] 手机：向天顶/天底快速 pan 并松手，pitch 撞 ±π/2 时**对应轴 velocity 清零**（不会持续撞墙）
- [ ] pad：横竖屏切换后手感一致
- [ ] 与原生 App（iOS/Android）手感对比，确认差异收敛
- [ ] `make js` 编译无警告（`-Werror` 开启）

> PC 端为非目标场景，但回归层面需保证：PC 端鼠标拖动也会触发惯性（pan 路径相同），不会比改动前更糟即可。

## 12. 参数调优后续

默认值是基于经验给的，跑起来后大概率要在以下方向微调：
- `DAMP_K` 觉得停得太慢 → 5.0~6.0
- `START_EPS` 微小拖动也想要惯性 → 调到 `0.05 * fov`
- `MAX_SAMPLE_DT` 想更宽容 → 0.2 秒
