# Tracker Template

## Header

- Task: 创建 Reffo 简历第二步 `jobDescription` 页面按设计稿做视觉收敛，先列差异，再逐项修复并逐项验证
- Workspace: `/Users/mi/code/reffo`
- Mode: `human-gated`
- Validation stack: Android 真机截图对比 + `src/pages/create/__tests__/index.test.tsx`
- Regression executor: `reffo-taro-rn-android-compare`，设备 `5aecc662`
- Reviewer mode: `user`
- Current branch: repo=`private/reffo-xgy`; submodule=`main`

## Problem

- User-reported issue:
  `jobDescription` 步骤当前页面与设计稿差距较大，工牌区域过宽、纵向位置不对、卡片质感不足、缺少右侧渐变蒙层和柔和橙色光团、生成按钮未左对齐。
- Root cause summary:
  当前实现采用满宽卡片布局和较通用的暖色表单样式，缺少设计稿里的窄卡片舞台、卡面分层、背景光感和左对齐 CTA 节奏。
- Constraints:
  只修复创建流程第二步视觉，不改表单行为和提交流程；工作区已有用户改动，不能回退。
- Out-of-scope items:
  首页卡片堆、创建流程其他步骤、文案和交互逻辑变更。

## Solution

- Chosen approach:
  将问题拆成最小视觉单元，逐项修改 `src/pages/create/PageView.tsx`、`src/pages/create/styles.ts`、`src/pages/create/components/CreateBackdrop.tsx`、`src/pages/create/steps/JobDescriptionStep.tsx`，每项后都重新安装 RN 包并抓真机图确认。
- Rejected options:
  一次性改完全部视觉后统一验证；只用代码阅读或 Jest 断言代替真机截图。
- Why this boundary is minimal:
  每个单元只覆盖一个用户可见目标，避免布局、质感和按钮对齐相互干扰，能独立确认回归结果。

## Units

| Unit | Goal | Scope | Validation | CR | Commit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 收窄工牌宽度并调整舞台纵向位置，使卡片更接近设计稿构图 | `src/pages/create/PageView.tsx`, `src/pages/create/styles.ts`, `src/pages/create/steps/JobDescriptionStep.tsx` | 真机截图 + create 页面 Jest | user |  | regression_passed |
| U2 | 补足卡片质感，包括暖色表面、右侧渐变蒙层、柔和橙色光团和整体背景光感 | `src/pages/create/components/CreateBackdrop.tsx`, `src/pages/create/steps/JobDescriptionStep.tsx` | 真机截图 + create 页面 Jest | user |  | regression_passed |
| U3 | 修正工牌顶部蓝色条幅的宽度、位置和局部控件细节 | `src/pages/create/steps/JobDescriptionStep.tsx` | 真机截图 + create 页面 Jest | user |  | regression_passed |
| U4 | 将“开始生成最佳简历”按钮改为左对齐并做页内剩余节奏收尾 | `src/pages/create/PageView.tsx`, `src/pages/create/styles.ts` | 真机截图 + create 页面 Jest | user |  | regression_passed |
| U5 | 将第二步改成非滚动满视口布局，卡片宽度取屏幕 80%，高度吃掉中段剩余空间 | `src/pages/create/PageView.tsx`, `src/pages/create/styles.ts`, `src/pages/create/steps/JobDescriptionStep.tsx` | 真机截图 + create 页面 Jest | user |  | regression_passed |
| U6 | 继续压缩顶部与底部留白，进一步抬大卡片可视面积但保持非滚动布局 | `src/pages/create/PageView.tsx`, `src/pages/create/styles.ts`, `src/pages/create/steps/JobDescriptionStep.tsx` | 真机截图 + create 页面 Jest | user |  | regression_passed |

## Unit Logs

### U1

- Objective: 收窄工牌宽度并调整舞台纵向位置，使卡片更接近设计稿构图
- Files:
  `src/pages/create/styles.ts`, `src/pages/create/steps/JobDescriptionStep.tsx`
- Code changes:
  为 `jobDescription` 紧凑布局增加更大的标题区与卡片区间距；将工牌卡片限制到 `304px` 最大宽度并保持中轴对齐；同步收紧提示文案列宽，避免卡片舞台再次被撑宽。
- Regression added or updated:
  无新增测试，用现有 create 页面 Jest 和真机截图作为本单元回归证据。
- Regression executor: Android 真机 `5aecc662`
- Validation commands:
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && ./scripts/build-rn.sh --port 8083`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm android -- --deviceId 5aecc662`
- Validation artifacts:
  修改前：`.artifacts/reffo-rn-android/create-form/20260401-baseline/job-description-page-before.png`
  U1 第一次验证：`.artifacts/reffo-rn-android/create-form/20260401-u1/u1-after-reinstall.png`
  U1 通过截图：`.artifacts/reffo-rn-android/create-form/20260401-u1/u1-after-v2.png`
- CR findings:
  无
- Resolution:
  真机复查后确认卡片宽度已经收窄，且纵向位置从偏上调整到更接近设计稿中轴。
- Commit message:
- Commit:
- Remaining follow-up:
  U2 继续处理卡片材质、背景光团和右侧高光蒙层。

### U2

- Objective: 补足卡片质感，包括暖色表面、右侧渐变蒙层、柔和橙色光团和整体背景光感
- Files:
  `src/pages/create/components/CreateBackdrop.tsx`, `src/pages/create/steps/JobDescriptionStep.tsx`
- Code changes:
  为暖色背景加入顶部粉橙洗色和中段柔光；为工牌卡片增加 SVG 暖色底、右侧白色斜向高光和橙色漫反射；同步把输入壳层和 JD 面板改成半透明暖白，避免继续显得“发白发平”。
- Regression added or updated:
  无新增测试，用现有 create 页面 Jest 和真机截图作为本单元回归证据。
- Regression executor: Android 真机 `5aecc662`
- Validation commands:
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && ./scripts/build-rn.sh --port 8083`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm android -- --deviceId 5aecc662`
- Validation artifacts:
  `.artifacts/reffo-rn-android/create-form/20260401-u2/u2-after.png`
- CR findings:
  无
- Resolution:
  真机确认卡面已经带有暖色层次、斜向白色高光和更柔和的橙色背景氛围。
- Commit message:
- Commit:
- Remaining follow-up:
  U3 继续收顶部 ribbon 和把手的局部比例。

### U3

- Objective: 修正工牌顶部蓝色条幅的宽度、位置和局部控件细节
- Files:
  `src/pages/create/steps/JobDescriptionStep.tsx`
- Code changes:
  收窄顶部把手；把蓝色条幅的高度、尾角和左侧折角进一步压薄，并把条幅整体下沉少量，减轻“厚横条”的感觉。
- Regression added or updated:
  无新增测试，用现有 create 页面 Jest 和真机截图作为本单元回归证据。
- Regression executor: Android 真机 `5aecc662`
- Validation commands:
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && ./scripts/build-rn.sh --port 8083`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm android -- --deviceId 5aecc662`
- Validation artifacts:
  `.artifacts/reffo-rn-android/create-form/20260401-u3/u3-after.png`
- CR findings:
  无
- Resolution:
  真机确认 ribbon 更轻薄，和顶部把手之间的比例更接近设计稿。
- Commit message:
- Commit:
- Remaining follow-up:
  U4 处理底部按钮左对齐。

### U4

- Objective: 将“开始生成最佳简历”按钮改为左对齐并做页内剩余节奏收尾
- Files:
  `src/pages/create/styles.ts`
- Code changes:
  将紧凑布局 footer 改成左对齐，增加左内边距以对齐内容列；同步缩小按钮宽高和文字尺寸，让 CTA 更接近设计稿的胶囊比例。
- Regression added or updated:
  无新增测试，用现有 create 页面 Jest 和真机截图作为本单元回归证据。
- Regression executor: Android 真机 `5aecc662`
- Validation commands:
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && ./scripts/build-rn.sh --port 8083`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm android -- --deviceId 5aecc662`
- Validation artifacts:
  `.artifacts/reffo-rn-android/create-form/20260401-u4/u4-final.png`
- CR findings:
  无
- Resolution:
  真机确认 `开始生成最佳简历` 已从水平居中改为左对齐，并且没有破坏前面三个单元的视觉结果。
- Commit message:
- Commit:
- Remaining follow-up:
  无

### U5

- Objective: 将第二步改成非滚动满视口布局，卡片宽度取屏幕 80%，高度吃掉中段剩余空间
- Files:
  `src/pages/create/PageView.tsx`, `src/pages/create/styles.ts`, `src/pages/create/steps/JobDescriptionStep.tsx`
- Code changes:
  将第二步内容区锁到视口高度，拆成固定标题区和可伸缩卡片区；卡片继续按窗口宽度 `80%` 取宽，并压缩标题区与底部外层留白，让工牌卡片真实占据标题和 CTA 之间的剩余高度。
- Regression added or updated:
  无新增测试，用现有 create 页面 Jest 和真机截图作为本单元回归证据。
- Regression executor: Android 真机 `5aecc662`
- Validation commands:
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && ./scripts/build-rn.sh --port 8083`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm android -- --deviceId 5aecc662`
- Validation artifacts:
  进入第二步：`.artifacts/reffo-rn-android/create-form/20260401-u5-recheck/after-start-tap.png`
  上滑后复查：`.artifacts/reffo-rn-android/create-form/20260401-u5-recheck/after-swipe-check.png`
  设备锁屏态排查：`.artifacts/reffo-rn-android/create-form/20260401-u5-recheck/unlocked.png`
- CR findings:
  无
- Resolution:
  真机确认卡片宽度约为屏幕的 `80%`，并在标题区与底部按钮之间占据更大的剩余高度；上滑前后截图无可见位移，本步骤用户侧已表现为非滚动满视口页面。黑屏现象确认是设备停在系统锁屏层，不是页面渲染问题。
- Commit message:
- Commit:
- Remaining follow-up:
  无

### U6

- Objective: 继续压缩顶部与底部留白，进一步抬大卡片可视面积但保持非滚动布局
- Files:
  `src/pages/create/PageView.tsx`, `src/pages/create/styles.ts`, `src/pages/create/steps/JobDescriptionStep.tsx`
- Code changes:
  第二步单独下调顶部安全区内边距，并继续收紧关闭按钮下方、标题下方、卡片底部提示与 CTA 前的紧凑态留白；不改卡片 80% 宽度和中段填充逻辑，只让同一视口里更多面积让给卡片。
- Regression added or updated:
  无新增测试，用现有 create 页面 Jest 和真机截图作为本单元回归证据。
- Regression executor: Android 真机 `5aecc662`
- Validation commands:
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && ./scripts/build-rn.sh --port 8083`
  `cd /Users/mi/code/reffo/frontend/Taro/reffo-taro && pnpm android -- --deviceId 5aecc662`
- Validation artifacts:
  第二步截图：`.artifacts/reffo-rn-android/create-form/20260401-u6/final.png`
  上滑后复查：`.artifacts/reffo-rn-android/create-form/20260401-u6/after-swipe.png`
- CR findings:
  无
- Resolution:
  真机确认标题与卡片之间的空白继续缩小，卡片可视面积更大；上滑前后截图无可见位移，本步骤仍保持非滚动满视口表现。
- Commit message:
- Commit:
- Remaining follow-up:
  无

## Remaining Items

- Remaining functional units:
  无
- Cleanup-only units:
  暂无
- Open risks:
  设计稿来自静态图，未提供精确尺寸标注，需要基于真机比例做视觉逼近。

## Final Summary

- Functional commits:
- Cleanup commits:
- Final validation:
  `pnpm test -- src/pages/create/__tests__/index.test.tsx --runInBand` 通过；真机最终截图：`.artifacts/reffo-rn-android/create-form/20260401-u6/final.png`
- Deferred items:
  无
