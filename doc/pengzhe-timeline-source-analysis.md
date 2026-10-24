# Peng Zheng 时间轴线上源码全量分析

> 参考站：`https://www.pengzhe.ng/cn#timeline`
>
> 抓取时间：2026-10-23
>
> 本地源码包：`.artifacts/pengzhe-timeline-source/`
>
> 分析对象：时间轴 `.tl-zone` 的布局、坐标场、交互状态机、视觉渲染、音频和卡片联动边界。

## 结论先行

参考站的时间轴不是 CSS 轨道动画，也不是若干独立元素分别做 transition。它是一个原生 DOM 动画引擎：

1. JS 根据数据和 DOM 实测宽度建立两套几何：一级 item 位置和一级 tick slot。
2. 长按后把日期/月份节点展开到同一条轨道，并重建一条完整的一级到二级坐标折线。
3. 每帧先计算统一坐标场，再把 tick、月份分隔、日期、二级 label、cap 全部通过同一坐标场绘制。
4. 鼠标牵引、月份吸附、端点拉伸、长按压缩、二级展开、关闭回弹都是坐标场状态，不是独立 CSS 动画。
5. 日期文字使用 3D reel，且包含 5 层运动模糊 clone；卡片数据切换另有 ghost、flight 和延迟入场机制。

当前 Reffo 实现已经拿到了大量常量和表面行为，但仍是“多个近似公式叠加”的实现。它缺少参考站最核心的完整坐标场、二级窗口排布、碰撞遮罩和长按状态机，所以无论继续微调 padding、duration 或 easing，都很难达到相同手感。

这不是少读了某一个样式文件，而是缺少以下结构：

- 完整的 `Pn -> Fn -> Mr` 连续坐标场管线。
- 完整的二级节点几何和窗口滚动状态。
- 基于几何碰撞的 tick/label 遮罩，而不是整段矩形遮罩。
- 参考站的长按压缩、细粒度拖拽、关闭回弹状态机。
- 日期 reel 的多层运动模糊。

## 1. 抓取范围

### 1.1 已下载内容

本地包共 25 个文件，约 `936KB`：

| 类别 | 数量 | 内容 |
| --- | ---: | --- |
| HTML | 1 | 页面生产 HTML |
| JS | 15 | 页面脚本、时间轴主逻辑和递归本地依赖 |
| CSS | 3 | 页面样式、基础样式、字体样式 |
| 字体 | 5 | 参考站本地托管的字体文件 |
| 清单 | 1 | `MANIFEST.md` |

核心文件：

| 文件 | 作用 |
| --- | --- |
| `html/index.html` | 初始 DOM、数据节点和脚本入口 |
| `js/StripTimeline.astro_astro_type_script_index_0_lang.C09ZNLrF.js` | 时间轴布局、状态机、渲染、输入、音频和 tick flight |
| `js/strip-filter-motion.DwhOPz9c.js` | 日期 reel、运动模糊、卡片 FLIP 和 spring easing |
| `css/HomePage.sBKGpWYJ.css` | `.tl-zone` 和卡片轨道的全部生产样式 |
| `css/Base.CXhVdFf5.css` | 字体、主题变量和基础样式 |
| `js/flight-math.BYegi54H.js` | 卡片 flight 的曲线、速度和路径修正 |
| `js/tap-haptics.BqTLhtPH.js` | 移动端触觉反馈和按压覆盖层 |
| `js/render-scale-pin.B7QgnyNK.js` | 3D 模型 render scale 固定，避免 flight/resize 时视觉漂移 |
| `js/glass-repaint.Bv7GcvCC.js` | WebGL/glass 材质 repaint |

### 1.2 抓取边界

这份包是参考站线上生产 bundle 的完整时间轴依赖闭包，不是作者未公开的 Astro/TypeScript 源仓库。生产 JS 已经过 minify，变量名被压缩，但算法、公式、DOM 写入和事件链均完整保留。

时间轴 CSS 还引用了 CDN 上的 Sunghyun Sans JP 动态 subset，以及页面 3D 模块使用的 `model-viewer`。这些不是时间轴交互源码，未纳入本地包。时间轴本体所需的：

- `StripTimeline`
- `strip-filter-motion`
- 页面 CSS
- 本地字体和字体度量规则

均已包含。任何 claim “只缺某个 CSS”或“只差某个 easing”都不成立。

## 2. 页面结构和初始化

### 2.1 初始 DOM

```html
<section
  class="last-seen"
  data-last-seen-root
  data-timeline="/_timeline/8ea22f108f542e14.html"
  data-newest-id="..."
  data-current-id="..."
  data-expanded="false"
>
  <div class="strip-wrap" data-strip-wrap inert>
    <div
      class="tl-zone"
      data-strip-timeline
      role="slider"
      tabindex="0"
      aria-label="打卡時間軸"
    >
      <div class="strip-track" data-strip-track></div>
    </div>
  </div>
</section>
```

真正的时间轴 DOM 不是 React 渲染的组件树，而是 `StripTimeline` 在 `.tl-zone` 内动态创建：

```text
.tl-zone
├── i.tl-tick                    x item/tick slot 数量
├── div.tl-sep                   x 月份边界数
├── div.tl-fine-label            x 日期节点
├── div.tl-fine-label.is-month   x 月份节点
├── div.tl-num-cap               x 2
└── div.tl-date
    └── 4 x span.tl-reel
```

### 2.2 初始化链路

```text
window.__pzTimeline
  -> timeline-ready
  -> StripTimeline await readiness
  -> 查询 last-seen root / strip / track / timeline
  -> 从 [data-strip-ts] 建立 item 时间数据
  -> Ar() 建立一级布局
  -> Sn() 测量二级文字宽度
  -> T2() 建立数据滚动目标
  -> Ur() 完成尺寸和布局
  -> zr() RAF 状态循环
```

`stripfilter` 事件触发时，时间轴会：

1. 保存当前 tick mark 的几何。
2. clone 当前轨道作为 `tl-ghost`，在 `200ms` 内淡出。
3. 停止旧实例并按新过滤数据重建。
4. 新轨道延迟 `300ms` 后在 `200ms` 内淡入。
5. 用 `480ms` spring easing 把旧 tick 飞到新 tick。

这部分与当前首页数据切换相关，但属于另一条视觉链路，不能和轨道 hover/fine 手感混为一谈。

## 3. 数据和一级布局

### 3.1 数据节点

参考站从每个卡片的 `[data-strip-ts]` 读取时间戳：

```text
item[i]
├── el：卡片 DOM
├── ms：时间戳
├── month：YYYY-M
├── prefix / day / suffix：Intl.DateTimeFormat 分段
```

一级布局并不是按卡片数量等分。

### 3.2 item 位置和 tick slot

`Ar()` 先按月份分组统计 item 数量，再给每个月份分配视觉 tick slot：

1. 月份组长度 `t2[]` 决定 slot 分配。
2. 先尝试总 item 数。
3. 如果 slot 间距小于 `7px`，逐级减少总 slot。
4. 最终 slot 尺寸限制在 `min(9, available / slots)`。
5. 每个月份先插入一个 separator slot。
6. item 在自己的月份组内按 item 数量均匀分布。
7. item 会映射到对应的视觉 tick slot。

最终产生三类坐标：

| 数组 | 含义 |
| --- | --- |
| `z[i]` | 数据 item 的逻辑中心 |
| `V[j]` | 视觉 tick slot 的中心 |
| `H[i]` | item 对应的视觉 tick slot |

所以一个 tick 可以代表多个数据 item，也可以由多个 item 共享；黄色选中 tick 使用 `H[A]`，而数据 marker 使用连续 `z` 插值。

### 3.3 当前实现

`referenceTimelineMath.ts` 的 `computeTimelineLayout()` 已经基本复刻了 slot 分配、月份 separator、item-to-slot 映射和 `7px/9px` 限制：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/referenceTimelineMath.ts:220`

这部分不是当前手感差的主因。真正的差距从“布局之后如何构造坐标场”开始。

## 4. 二级节点布局

### 4.1 节点定义

参考站的二级节点不是每个数据 item 一个：

1. 同一天的多个 item 合并成一个日期节点，节点记录 `a..b` item 范围。
2. 月份变化时额外插入一个月份节点。
3. 月份 label 和日期 label 都在同一个 `.tl-zone` 内，不是另一条独立子轨道。

### 4.2 文字宽度测量

`Sn()` 创建隐藏的日期/月份 label，按真实 DOM 字体测量宽度：

```text
contentWidth =
  getBoundingClientRect().width / rootScale
  - paddingLeft
  - letterSpacing

nodeWidth = contentWidth * renderScale + 12px
```

其中 `12px` 是节点间隙。`00` 样本宽度加 `12px` 形成 fine drag 的基础单位 `Ft`。

当前实现已有相同思路，但直接把 `fineNodeScaleValues` 用到中心布局中：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:331`
- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/referenceTimelineMath.ts:122`

参考站的 `Cn()` 也使用 render scale，但它与 `Mn/Nn/Pn` 的中心窗口、边界约束、稳定缓存共同工作。当前仅重算中心数组，不足以得到相同的拖拽和边界行为。

### 4.3 二级视觉

节点按当前节点距离取视觉值：

```text
opacity = [1, .78, .42, .30, .22]
scale   = [1.1, 1, .93, .88, .84]
```

实际只维护当前节点附近约 5 个节点，但这些节点仍在同一坐标场里。

## 5. 核心：连续坐标场

这是当前实现与参考站差异最大的部分。

### 5.1 参考站的数据流

```text
pointer raw
  -> smoothed hover x
  -> month clamp / snap / strain
  -> T3
  -> A2 = nearest continuous item
  -> align = V[H[A2]] - z[A2]
  -> le = T3 + align
  -> Pn() 构造完整 source/target 折线
  -> Fn() 统一 remap
  -> tick / sep / label / date / cap
```

关键点：

- `A2` 或 `visualIndex` 只决定当前黄色 tick、日期和 label。
- `marker` 只决定数据 index、键盘目标和卡片目标。
- 二者刻意分离。
- 所有视觉元素共享 `Fn()`，不允许 label 和 tick 各自套一层不同的 transform。

### 5.2 一级 tick 的牵引场

参考站不是用简单 Gaussian 决定黄标位置。它对每个位置使用：

```text
pull = 4 * tanh((position - le) / 20)
```

再把：

- 数据可见比例 `a`
- hover 强度
- 一级到 fine 的 blend
- 端点 strain
- 橡皮筋变形

全部合成到同一个 `ue2(position)`。

tick 的高度使用两个不同核：

```text
gaussianNear = exp(-(distance / (2.2 * 32))²)
edgeShape    = max(0, 1 - distance / 32)^1.5
```

颜色也不是“hot/glow 两个简单百分比”：

```text
hot%  = f(edgeShape, hoverEase, fineBlend)
glow% = f(gaussianNear, hoverEase, fineBlend)
background = color-mix(oklch, hot%, glowColor)
```

因此视觉上会形成：

1. 中心橙色高热区。
2. 橙色向外过渡。
3. glow-only 的灰橙色区域。
4. 轨道基础色。

当前实现使用 `gaussian(distance, 2.2*32)` 近似高度和颜色，并把 `hoverSnap`、`hoverStrain`、`endpointDeformation` 叠加到元素外层：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:533`

这正是“黄色标尺不跟鼠标、三色场不连续、元素看起来各自运动”的直接原因。

### 5.3 二级坐标折线

参考站 `Pn()` 每次布局变化都构造完整坐标折线：

```text
En[] = source positions
Dn[] = target positions
Fn(x) = 在 En/Dn 之间做 piecewise linear remap
```

折线包含：

- 左边界。
- 每个可见 fine 节点的原始 item 边界。
- 每个节点的 fine 中心。
- 右边界。
- 边界外保持斜率 `1`。

`Pn()` 还计算：

- 当前节点窗口 `Rt..zt`。
- 当前节点中心窗口 `Lt/It`。
- 左右溢出 `Ht/Ut`。
- 每个节点的 reveal/scale/opacity。
- tick、separator 的统一 remap。

当前 `samplePiecewisePositions()` 只对可见 5 个节点建立简化 source/target 数组：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/referenceTimelineMath.ts:87`
- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:486`

它没有复刻完整的节点边界、窗口滚动、边界覆盖和每帧重新构线，因此一级和二级之间的“呼吸、展开、收束”仍会显得跳变。

## 6. Hover 和端点物理

### 6.1 状态变量

参考站的状态不是一个 `hoverProgress`，而是：

```text
hover.raw / rawY / x / amt
hover.pop / popV / popT
hover.lean / pullX / pullY / pre
hover.month / held / strain / snap / align
```

每个状态都有独立时间常数或弹簧。

### 6.2 hover pop

进入 hover 时：

```text
popTarget -> 1，时间常数 45ms
pop spring: stiffness 484，阻尼按速度方向取 22 或 11
```

离开 hover 时不会继续播放过冲，而是把 `pop` 钳制在 `amt` 内。

### 6.3 月份吸附和 strain

- hover 位置先在月份范围内 clamp。
- 月份边界附近用指数 strain，而不是线性 clamp。
- 跨月份阈值会保留 `snap` 修正，避免月份 label 和 tick 突然换组。
- `snap` 和 `strain` 分别以 `40ms` 时间常数回零。

### 6.4 端点 rubber band

鼠标和触屏使用不同限制：

```text
mouse limit = 14px
touch limit = 22px
```

内部使用：

```text
rubberBand(value, limit)
```

端点释放后不是普通 CSS transition，而是独立二阶弹簧：

```text
ω = 2π × 3.2
accel = ω²(target - x) - 1.8ωv
```

当前实现已具备相似结构，但 hover 主体仍是 Gaussian 场，端点效果也没有参与统一 `Fn()`，所以物理连续性不完整。

## 7. 长按二级模式

### 7.1 长按判定

参考站不是简单 `setTimeout(700)`：

1. pointerdown 后保持不动，鼠标约 `500ms`、触屏约 `1000ms` 进入。
2. 如果先发生超过约 `6px` 的移动，则等待稳定 `150ms`。
3. 稳定后重新开始剩余计时，最终从“开始稳定”算约 `700ms/1000ms`。
4. 位移超过约 `6px` 会取消本轮长按。

当前实现从 pointerdown 直接计 `700ms/1000ms`，并用 `travelX/Y > 6` 取消：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:1000`
- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:1100`

这会带来按压启动速度和长按阈值上的明显差异。

### 7.2 按住阶段的压缩

参考站在长按进度 `lr` 期间已经有视觉变化：

```text
warp amount = lr * 0.15
pulse       = spring(lr, 0)
root scale  = 1 - 0.04 * pulse
root opacity filter = 1 - 0.12 * pulse
```

触发 fine 后，warp 进入 `Er/Dr/Tr` 管线，再逐步回到 0。当前实现把 `fineWarp/finePulse` 设置为近似值，但没有复刻：

- 按住期间的完整 `lr -> warp` 连续映射。
- 进入 fine 后的 warp 重心移动。
- 窗口位置在 warp 中的重新定位。

### 7.3 fine reveal

参考站使用两条独立时间轴：

```text
fine coordinate blend：约 70ms 进入、110ms 退出
fine label reveal：240ms 打开、144ms 关闭
```

标签不是一次性显示 5 个，而是根据当前节点窗口逐个 reveal：

```text
radius = -1
       -> 0
       -> 1
       -> 2
       -> 3
       -> 4
```

当前 `fineRevealRadius` 已有相近公式，但 `fineCover` 是整段矩形遮罩：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:438`
- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/useReferenceTimeline.h5.ts:521`

参考站使用逐元素几何距离判断 tick 与 label 是否相交，再对 tick 和 separator 分别做透明度/高度抑制。因此当前会出现“二级是独立覆盖层、重叠无法完全消除”的问题。

### 7.4 fine drag

参考站不是按固定像素步长切换节点。它有：

```text
on()：根据剩余距离、节点宽度和速度建立非线性映射
sn()：从逻辑拖拽位置映射到节点序号
cn()：从节点序号映射回连续拖拽位置
```

进入拖拽后：

1. 保存起点节点。
2. 以实际 fine 单位宽度和速度感知位移。
3. 允许跨多个节点连续移动。
4. 两端有独立映射和边界回滚。
5. 静止超过 `220ms` 后重新建立基准。

当前 `computeFineDragIndex()` 是简化版：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/referenceTimelineMath.ts:172`

它能防止明显重叠，但无法得到原版的加速度、边界回弹和连续吸附。

### 7.5 关闭和回弹

参考站的关闭条件：

- 鼠标速度超过约 `0.9px/ms`。
- 触屏在 `180ms` 内移动约 `80px`，且最近速度超过约 `0.5px/ms`。
- pointerup 也会关闭 fine。

关闭时：

```text
shake(t) = exp(-t / 60) * cos(2πt / 200)
window = 260ms
```

同时按住脉冲使用弹簧：

```text
fr += (-1156 * dr - 34 * fr) * dt
dr += fr * dt
```

当前实现有 `fineCloseShakeOffset` 和 pulse spring，但没有完整地把 close shake 放入所有 tick/sep/label 的统一坐标场。

## 8. 日期 reel

### 8.1 文字拆分

日期被拆成四段：

```text
prefix + day tens + day ones + suffix
```

每段独立测量宽度，整个 `.tl-date` 的宽度由四段之和决定。

### 8.2 3D 翻转

每一段不是普通 fade，而是：

```text
transform:
  perspective(3em)
  translateZ(-0.54em)
  rotateX(angle)
  translateZ(0.54em)

opacity = max(0, 1 - abs(angle) / 64)^1.5
```

翻转曲线通过 `cubic-bezier(0.4, 0, 0.2, 1)` 的数值求逆采样，生成 25 个关键帧。

### 8.3 运动模糊

每个 reel 有 5 层 clone：

```text
base scale = 0.03
clone scaleY = 1 / 0.03
blur = 0.03em ~ 0.06em
```

每层 opacity 根据 25 个采样点的角速度动态分配，再让 incoming/outgoing 同步播放。动画结束后清理 clone。

当前 `referenceTimelineReel.h5.ts` 仍只创建一个普通 ghost：

- `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/referenceTimelineReel.h5.ts:31`

所以日期切换的质感仍明显偏“两层 CSS 卡片翻转”，不是参考站的连续 3D reel。

### 8.4 月份切换

同月日期变化：

- 四段 reel 分别翻转。
- 动画时长根据触发间隔自适应，约 `260ms~520ms`。

跨月变化：

- 整个日期先按方向翻出。
- 重建整段文字。
- 整段新日期翻入。
- 约 `520ms` 内锁定，避免快速跨月时持续打断。

当前月份切换实现了一个整段 ghost，但没有复用上述多层 blur reel。

## 9. 音频、触觉和无障碍

### 9.1 Web Audio

参考站在 `StripTimeline` 内即时生成 buffer：

- 高通白噪声。
- `5200Hz` 和 `7400Hz` 两个正弦 partial。
- 指数衰减和尾部 fade。

音效类型：

| 类型 | 触发 |
| --- | --- |
| `line` | 同月 tick 变化 |
| `month` | 月份变化 |
| `travel` | 卡片/滚动跳转 |
| `fine` | 二级节点变化 |
| `close` | 关闭二级模式 |

当前 `referenceTimelineAudio.h5.ts` 的核心波形和调度已较接近，不是当前视觉问题的首要根因。

### 9.2 触觉

`tap-haptics` 为真实按钮创建隐藏 switch input，借助系统 switch 反馈产生触觉；同时用 `elementsFromPoint` 检查按钮是否真的可见、可点、未被遮挡。

### 9.3 无障碍

时间轴是 `role="slider"`：

- `aria-valuemin/max/now`
- `aria-valuetext`
- 左右/上下箭头步进
- PageUp/PageDown 按月跳转
- Home/End 到端点

黄色视觉 index 和数据 marker 分离，但 ARIA 只暴露数据 marker。

## 10. 相关模块边界

### 10.1 `flight-math`

负责卡片切换时的 x/y/scale 飞行：

- 自定义 bezier 求值和速度。
- 根据剩余距离生成二次曲线。
- 保证 flight 中断后速度连续。

该模块是首页数据切换的手感来源，与轨道本体 hover/fine 属于不同链路。本轮按要求不改卡片 flight。

### 10.2 `render-scale-pin`

在触屏设备上：

- 限制 image bitmap 最大纹理为 `2048`。
- 关闭 model-viewer cache。
- 固定 `minimumRenderScale`。

作用是防止 3D 模型在卡片 flight 或 resize 时出现尺度跳变，不直接控制时间轴 tick。

### 10.3 `glass-repaint`

在 `pageshow`、visibility 恢复和 WebGL context restored 后延迟触发 glass repaint。它是材质稳定性模块，不是时间轴坐标算法。

## 11. 当前实现为什么仍然差

### 11.1 根因排序

| 优先级 | 根因 | 现象 |
| --- | --- | --- |
| P0 | 缺少完整 `Pn -> Fn -> Mr` 坐标场 | 一级/二级元素看似各自 transform，运动不连续 |
| P0 | hover 使用 Gaussian 近似，缺少 `4*tanh` 牵引场 | 黄色 tick 不贴鼠标，三色梯度不自然 |
| P0 | fine 缺少完整节点窗口和碰撞遮罩 | 二级 label/tick 重叠，像另一层覆盖轨道 |
| P1 | 长按状态机不是参考站的稳定/压缩/回弹模型 | 长按启动生硬，展开像突然拉伸 |
| P1 | fine drag 使用简化节点映射 | 吸附、速度、边界滚转和原版不同 |
| P1 | cap/date 只做近似插值 | cap 跟随、日期消失和节点半径仍有细微跳动 |
| P2 | reel 只有一个 ghost，没有 5 层运动模糊 | 日期切换缺少原版厚度和速度感 |
| P2 | 音频/触觉细节尚未逐事件对齐 | 次要影响整体完成度 |

### 11.2 为什么现有测试都通过但效果仍不对

当前 Jest 和 Playwright 主要验证：

- 元素不重叠。
- alpha/scale 数值存在。
- 长按最终能进入/退出。
- reduced-motion 不产生动画。

这些是行为正确性，不等于运动学一致性。参考站的真实差异在：

- 每帧所有元素的坐标是否来自同一个场。
- 动画中间帧是否连续。
- 边界处是否有窗口滚动和几何遮罩。
- 鼠标速度、位移、历史状态是否参与状态机。

因此现有 TODO 中把 P0/P1 标成完成，只能说明“做了对应近似”，不能说明“已源码级复刻”。

### 11.3 不建议继续做的调整

以下调整不会解决根因：

- 继续单改 `duration` 或 `easing`。
- 用额外 z-index 解决二级重叠。
- 用更宽的 label cover 矩形隐藏 tick。
- 给 selected tick 单独增加 spring。
- 用更多 CSS transition 模拟 warp。
- 让二级 label 使用一条独立坐标轴。

这些都会增加状态分叉，让效果更难收敛。

## 12. 建议的源码级改造单元

### R1：重建完整一级坐标场

目标：

- 引入 `T3/A2/le` 连续选中链路。
- 每个 tick 使用 `4*tanh((x-le)/20)` 牵引。
- 所有 tick/sep 使用同一 `fieldTransform()`。
- 完成 hot/glow/base 三色场。

验收：

- 黄色 tick 的中心误差小于 `0.5px`。
- 连续采样 tick 位移无跳变。
- 三色边界由颜色场产生，不再靠手工百分比拼接。

### R2：移植 `Pn/Fn` 二级坐标折线

目标：

- 构建完整 source/target 点列。
- 覆盖节点边界、可见窗口和边界外斜率。
- tick、separator、date、fine label、cap 全部使用同一 remap。

验收：

- 任意时间采样，所有元素共享同一坐标函数。
- label/tick 不需要整段矩形遮罩即可不重叠。

### R3：重建 fine 窗口和几何碰撞

目标：

- 复刻 `Mn/Nn/Pn/Gt2` 的窗口、中心缓存和 collision mask。
- 用元素实际宽度和半径做逐 tick/label 抑制。
- 保持二级 label 在原轨道内展开。

验收：

- 二级展开后 label、tick、cap 无重叠。
- 鼠标可连续滑到两端，不存在中途吞节点。

### R4：重建长按、drag、close 状态机

目标：

- 复刻稳定 `150ms` 后重新计时。
- 复刻 `lr -> warp -> pulse -> reveal`。
- 复刻 `on/sn/cn` 非线性 drag。
- 复刻鼠标/触屏 close 阈值和 close shake。

验收：

- 长按、拖动、快速滑动、pointerup 四条路径都可预测。
- reduced-motion 下直接落位且不播放 warp/pulse/shake。

### R5：重建日期 reel

目标：

- 25 点 bezier 数值采样。
- 5 层 blur clone。
- 自适应 `260~520ms`。
- 跨月整段 reel 和 `520ms` lock。

验收：

- 快速连续切换无 ghost 残留。
- 运动模糊峰值随速度变化，而不是固定 opacity。

### R6：音频和触觉收尾

目标：

- 按 `line/month/travel/fine/close` 精确触发。
- 对齐调度、clear 和 distance level。
- 核对触觉触发和 reduced-motion/系统能力降级。

## 13. 推荐实现架构

建议不要继续在 `useReferenceTimeline.h5.ts` 中堆更多局部变量。应拆成三个纯状态层：

```text
TimelineGeometry
  - itemPositions
  - slotPositions
  - itemSlotIndexes
  - fineNodes
  - fineCenters

TimelineMotionState
  - hover
  - marker/glide
  - finePress/fineWarp/fineReveal
  - endpointSpring
  - closeShake

TimelineCoordinateField
  - build(source, target, bounds)
  - map(position)
  - tickStyle(slot)
  - labelStyle(node)
  - dateStyle()
```

React/Taro 组件只负责：

- 创建稳定 DOM 容器。
- 提供 item 数据。
- 回调 active index。
- 调用 H5 motion controller。

所有 transform、opacity、width、height、background 都应由 RAF 状态层写入，避免组件重渲染打断动画。

## 14. 验收标准

完成源码级复刻后，至少应满足：

1. 鼠标移动时黄色 tick 与指针是连续牵引关系，不是离散跳位。
2. 一级、二级、日期、cap 在中间帧使用同一坐标场。
3. 二级展开在原轨道中完成，不出现独立覆盖层。
4. label、tick、separator 通过几何 collision 避免重叠。
5. 长按压缩、fine reveal、close shake 与参考时间曲线一致。
6. 二级 drag 支持速度感知、边界回滚和连续吸附。
7. 日期 reel 具备 5 层运动模糊，快速切换无残留。
8. reduced-motion 下无 warp、pulse、shake、ghost。
9. 保持当前 `marker` 与 `visualIndex` 的业务语义，不破坏卡片回调。

## 15. 最终判断

当前问题不是“还没调好”，而是实现模型不同：

- 参考站：一个连续坐标场，多种物理状态共同驱动所有元素。
- 当前实现：多个近似局部公式，分别驱动 tick、label、cap 和日期。

在没有移植完整 `Pn/Fn` 和 fine 窗口碰撞前，继续调参只能缩小一部分表面差距，无法解决黄标跟手、二级重叠和运动不丝滑。

下一轮应按 `R1 -> R2 -> R3 -> R4 -> R5` 顺序做源码级移植，每完成一层都做中间帧几何采样。音频和卡片 flight 放在核心轨道手感完成后再收尾。
