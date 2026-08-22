# Reffo 社交品牌字体与素材来源清单

> 记录日期：2026-08-16  
> 当前状态：本阶段仅使用仓库自有品牌资产、源码视觉令牌和系统字体；未引入第三方图片、图标库或 AI 生成图片。

## 1. 品牌资产

| 资产 | 仓库来源 | 用途 | 授权/确认状态 |
|---|---|---|---|
| Reffo 组合 Logo PNG | `frontend/Taro/reffo-taro/src/assets/branding/reffo-logo.png` | 正式发布时的组合 Logo | 项目现有资产；品牌方需最终确认标准用法 |
| Reffo 图形标 SVG | `frontend/Taro/reffo-taro/src/assets/branding/Vector.svg` | 头像、角标、模板图形标 | 项目现有可编辑矢量资产 |
| 首页卡片语言 | `frontend/Taro/reffo-taro/src/components/business/HomeCardDeck/` | 档案卡比例、堆叠、索引轨、材质参考 | 源码派生的品牌辅助图形 |
| App 色彩令牌 | `frontend/Taro/reffo-taro/src/styles/tokens.ts`、页面 SCSS | 社交设计令牌 | 源码事实 |

模板中没有复制 `home-card-theme-x.png` 等位图纹理，避免把运行时材质误当作独立品牌素材。需要使用时，应从实际运行画面截图，不单独拼装成伪 UI。

## 2. 字体

| 字体角色 | 字体栈 | 来源 | 随包分发 |
|---|---|---|---|
| 中文/拉丁主字体 | `-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif` | 操作系统字体 | 否 |
| 评分字母 | `Georgia, Times New Roman, serif` | 操作系统字体 | 否 |
| 代码/字段 | `SF Mono, Menlo, Monaco, Consolas, monospace` | 操作系统字体 | 否 |

当前不附带 `.otf`、`.ttf` 或 `.woff`。如果未来指定思源黑体、HarmonyOS Sans 或商业字体，必须补充：字体版本、下载/采购来源、桌面使用许可、商用发布许可和是否允许随源文件分发。

## 3. 图标

模板中的箭头、对勾、叉号、索引刻度和文档轮廓均由基础 SVG 几何绘制，没有引入第三方图标库。产品截图中的图标必须来自真实运行页面，不从截图中拆出后改造成新功能图标。

## 4. 图片与 AI 素材

本阶段未使用人物照片、图库图片或 AI 生成图片，因此暂无外部图片授权。后续每个新增图片应记录：

```text
文件名：
来源平台/生成工具：
原始链接或任务 ID：
作者/账号：
获取日期：
授权范围：
是否允许商业使用：
是否含人物肖像：
AI 提示词与模型版本：
修改记录：
```

AI 图片只能用于人物、环境和无产品信息的背景，不得生成产品 UI、简历内容、价格、用户评价或录用结果。

## 5. 真实产品截图

真实截图不随模板预置。后续每张截图应记录：

```text
页面/路由：
截取日期：
产品版本或 commit：
视口/设备：
演示账号或数据集：
脱敏负责人：
授权状态：
对应宣传卖点：
```

含用户隐私或业务数据的原始截图不得提交到公开素材目录；只允许使用不可逆脱敏副本。
