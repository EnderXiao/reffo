# 首页动画效果实现文档

## 概述

本文档描述了首页组件中实现的所有动画效果，包括卡片进入动画、点击反馈、悬停效果等。

**验证需求: Requirements 4.6**

## 动画列表

### 1. 卡片进入动画 (cardSlideIn)

**效果**: 卡片从下方淡入并向上滑动进入视图

**实现**:

```scss
@keyframes cardSlideIn {
  from {
    opacity: 0;
    transform: translateY(30px) translateX(0) rotate(0deg);
  }
  to {
    opacity: 1;
    transform: translateY(0) translateX(0) rotate(0deg);
  }
}

.card {
  animation: cardSlideIn 0.5s $ease-out;
  animation-fill-mode: both;

  // 为每张卡片设置不同的延迟
  &:nth-child(1) {
    animation-delay: 0.1s;
  }
  &:nth-child(2) {
    animation-delay: 0.2s;
  }
  &:nth-child(3) {
    animation-delay: 0.3s;
  }
}
```

**特点**:

- 持续时间: 0.5秒
- 缓动函数: ease-out
- 每张卡片延迟递增 0.1秒

### 2. 卡片点击反馈动画

**效果**: 点击卡片时缩小到 95%

**实现**:

```scss
.card {
  &:active {
    transform: scale(0.95) !important;
    transition: transform $transition-fast;
  }
}
```

**特点**:

- 使用快速过渡 (150ms)
- 缩放到 95%

### 3. 卡片悬停效果 (H5 平台)

**效果**: 鼠标悬停时卡片向上浮动并放大

**实现**:

```scss
.card {
  @media (hover: hover) {
    &:hover {
      transform: translateY(-10px) scale(1.02) !important;
      transition: transform $transition-base;

      .cardInner {
        box-shadow:
          $shadow-2xl,
          0 30px 60px -15px rgba(0, 0, 0, 0.3);
      }
    }
  }
}
```

**特点**:

- 仅在支持悬停的设备上生效
- 向上移动 10px
- 放大到 102%
- 增强阴影效果

### 4. 空状态淡入动画 (fadeIn)

**效果**: 元素从透明淡入并向上移动

**实现**:

```scss
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.emptyState {
  animation: fadeIn 0.6s $ease-out;
}

.emptyTitle {
  animation: fadeIn 0.6s $ease-out 0.2s both;
}

.emptyDescription {
  animation: fadeIn 0.6s $ease-out 0.4s both;
}
```

**特点**:

- 不同元素有不同的延迟
- 标题延迟 0.2秒
- 描述延迟 0.4秒

### 5. 空状态图标弹跳动画 (iconBounce)

**效果**: 图标向上弹跳

**实现**:

```scss
@keyframes iconBounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.emptyIcon {
  animation: iconBounce 1s $ease-out 0.3s;
}
```

**特点**:

- 持续时间: 1秒
- 延迟: 0.3秒
- 只播放一次

### 6. 按钮点击反馈

**效果**: 按钮点击时缩小到 97%

**实现**:

```scss
.button {
  &:active:not(.button--disabled):not(.button--loading) {
    transform: scale(0.97);
    transition: transform $transition-fast;
  }
}
```

**特点**:

- 快速过渡
- 不影响禁用或加载状态的按钮

### 7. 按钮涟漪效果

**效果**: 点击时产生涟漪扩散效果

**实现**:

```scss
.button {
  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    transform: translate(-50%, -50%);
    transition:
      width 0.6s,
      height 0.6s;
  }

  &:active::after {
    width: 300px;
    height: 300px;
  }
}
```

**特点**:

- 使用伪元素实现
- 从中心扩散
- 持续时间: 0.6秒

### 8. 按钮悬停效果 (H5 平台)

**效果**: 主按钮悬停时向上浮动并增强阴影

**实现**:

```scss
.button--primary {
  @media (hover: hover) {
    &:hover:not(.button--disabled):not(.button--loading) {
      background: $color-primary-dark;
      box-shadow: $shadow-lg;
      transform: translateY(-2px);
    }
  }
}
```

**特点**:

- 向上移动 2px
- 背景色变深
- 阴影增强

### 9. Logo 脉冲动画 (pulse)

**效果**: Logo 图标持续脉冲

**实现**:

```scss
@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba($color-primary, 0.7);
  }
  50% {
    transform: scale(1.05);
    box-shadow: 0 0 0 10px rgba($color-primary, 0);
  }
}

.logoIcon {
  animation: pulse 2s $ease-in-out infinite;
}
```

**特点**:

- 持续时间: 2秒
- 无限循环
- 带有阴影扩散效果

### 10. 标语高亮下划线动画 (underlineExpand)

**效果**: 下划线从左到右展开

**实现**:

```scss
@keyframes underlineExpand {
  from {
    width: 0;
  }
  to {
    width: 100%;
  }
}

.heroHighlight {
  &::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -2px;
    width: 0;
    height: 3px;
    background: $color-primary;
    animation: underlineExpand 1s $ease-out 0.8s forwards;
  }
}
```

**特点**:

- 持续时间: 1秒
- 延迟: 0.8秒
- 保持最终状态 (forwards)

### 11. 评分卡片弹出动画 (popIn)

**效果**: 评分卡片从小到大弹出

**实现**:

```scss
@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0.8) translateY(10px);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.scoreCard {
  animation: popIn 0.5s $ease-out 0.6s both;
}
```

**特点**:

- 持续时间: 0.5秒
- 延迟: 0.6秒
- 中间有超过 100% 的弹性效果

### 12. 评分数字脉冲动画 (numberPulse)

**效果**: 评分数字持续脉冲

**实现**:

```scss
@keyframes numberPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.scoreNumber {
  animation: numberPulse 2s $ease-in-out infinite;
}
```

**特点**:

- 持续时间: 2秒
- 无限循环
- 微妙的缩放效果

### 13. 加载文本脉冲动画 (textPulse)

**效果**: 加载文本透明度变化

**实现**:

```scss
@keyframes textPulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

.loadingText {
  animation: textPulse 1.5s $ease-in-out infinite;
}
```

**特点**:

- 持续时间: 1.5秒
- 无限循环
- 透明度在 0.6 和 1 之间变化

### 14. 错误文本抖动动画 (shake)

**效果**: 错误文本左右抖动

**实现**:

```scss
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  10%,
  30%,
  50%,
  70%,
  90% {
    transform: translateX(-5px);
  }
  20%,
  40%,
  60%,
  80% {
    transform: translateX(5px);
  }
}

.errorText {
  animation: shake 0.5s $ease-out;
}
```

**特点**:

- 持续时间: 0.5秒
- 快速左右抖动
- 只播放一次

### 15. 卡片图案移动动画 (patternMove)

**效果**: 背景几何图案缓慢移动

**实现**:

```scss
@keyframes patternMove {
  0% {
    background-position:
      0 0,
      0 0;
  }
  100% {
    background-position:
      70px 70px,
      -70px 70px;
  }
}

.geometricPattern {
  animation: patternMove 20s linear infinite;
}
```

**特点**:

- 持续时间: 20秒
- 无限循环
- 线性缓动
- 非常微妙的效果

### 16. 头部滑入动画 (slideInLeft / slideInRight)

**效果**: 头部元素从左右两侧滑入

**实现**:

```scss
@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.headerLeft {
  animation: slideInLeft 0.5s $ease-out;
}

.headerRight {
  animation: slideInRight 0.5s $ease-out;
}
```

**特点**:

- 持续时间: 0.5秒
- 从两侧同时滑入
- 增加视觉趣味性

## 动画变量

所有动画使用统一的设计 token：

```scss
// 过渡时间
$transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
$transition-base: 300ms cubic-bezier(0.4, 0, 0.2, 1);
$transition-slow: 500ms cubic-bezier(0.4, 0, 0.2, 1);

// 缓动函数
$ease-in: cubic-bezier(0.4, 0, 1, 1);
$ease-out: cubic-bezier(0, 0, 0.2, 1);
$ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

## 性能优化

### 1. 使用 transform 和 opacity

所有动画优先使用 `transform` 和 `opacity` 属性，这些属性可以被 GPU 加速，性能最佳。

### 2. 避免布局抖动

动画不会触发布局重排（reflow），只触发重绘（repaint）或合成（composite）。

### 3. 使用 will-change (谨慎)

对于频繁动画的元素，可以考虑添加 `will-change` 提示浏览器优化：

```scss
.card {
  will-change: transform, opacity;
}
```

**注意**: 不要过度使用 `will-change`，它会消耗额外的内存。

### 4. 媒体查询优化

悬停效果仅在支持悬停的设备上启用：

```scss
@media (hover: hover) {
  &:hover {
    // 悬停效果
  }
}
```

这避免了在触摸设备上的不必要的动画。

## 可访问性考虑

### 1. 尊重用户偏好

对于有运动敏感的用户，应该提供禁用动画的选项：

```scss
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 2. 保持功能性

所有动画都是装饰性的，禁用动画不会影响功能。

## 测试

动画效果通过以下测试验证：

1. **CSS 样式类测试**: 验证所有动画相关的样式类正确导出
2. **动画关键帧测试**: 验证所有 @keyframes 定义存在
3. **实现验证测试**: 验证动画效果的实现符合设计要求

运行测试：

```bash
npm test -- src/pages/index/__tests__/animations.test.tsx
```

## 浏览器兼容性

所有动画使用标准 CSS3 属性，兼容：

- iOS Safari 12+
- Chrome 60+
- Firefox 60+
- Edge 79+

对于不支持的浏览器，动画会优雅降级，不影响功能。

## 未来改进

1. **添加更多微交互**: 如拖拽、滑动等手势动画
2. **性能监控**: 添加动画性能监控，确保 60fps
3. **自定义动画**: 允许用户自定义动画速度和效果
4. **主题动画**: 不同主题使用不同的动画风格

## 参考资料

- [CSS Animations - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations)
- [CSS Transitions - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Transitions)
- [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API)
- [Taro 动画文档](https://taro-docs.jd.com/docs/apis/ui/animation/createAnimation)
