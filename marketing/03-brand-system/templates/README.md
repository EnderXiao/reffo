# Reffo 社交模板使用说明

本目录的模板是可编辑 SVG。中文标题、标签、页码和声明均为 `<text>` 元素，不是路径。

## 文件清单

- `xiaohongshu-cover-1242x1660.svg`：小红书 3:4 封面。
- `xiaohongshu-carousel-page-1242x1660.svg`：小红书轮播内页。
- `vertical-video-cover-1080x1920.svg`：竖版视频封面。
- `article-header-1920x1080.svg`：横版文章头图。
- `do-dont-examples-1920x1080.svg`：允许/禁止视觉示例。
- `logo-lockup-editable.svg`：标准图形标 + 可编辑工作字标。
- `font-and-asset-sources.md`：字体与素材来源。

## 编辑顺序

1. 复制模板，不在母版上直接改。
2. 在 Figma、Illustrator、Affinity Designer 或 Inkscape 打开 SVG。
3. 编辑 `copy-layer` 内的标题、标签与说明。
4. 将 `screenshot-placeholder` 替换为实际运行 H5 的脱敏截图。
5. 保持截图等比，不修改截图内按钮、文案、评分或功能状态。
6. 删除占位提示文字；保留低层级 AI 核验声明。
7. 用手机缩略图预览并逐字校对中文。
8. 保存可编辑 SVG，再导出 sRGB PNG。

## 图层约定

- `background-layer`：背景与空气渐变。
- `brand-layer`：图形标、工作字标和栏目标签。
- `copy-layer`：全部可编辑中文。
- `graphic-layer`：档案卡、索引轨等辅助图形，不是产品 UI。
- `screenshot-placeholder`：真实截图替换区，发布前必须替换。
- `legal-layer`：AI、匿名与示意声明。
- `guide-layer`：编辑提示；发布前隐藏或删除。

## 截图替换规则

模板不内置产品 UI。正式物料只能使用实际运行截图或录屏帧，并满足：

- 姓名、电话、邮箱、地址、学校、公司和可定位项目不可见；
- 使用真实功能状态，不拼接不存在的页面；
- 工作机制示意必须明确写“示意，非当前产品页面”；
- 原始截图与脱敏副本分开保存；
- 用户案例需保留授权记录。

## 字体

模板默认字体栈：`PingFang SC, Microsoft YaHei, Arial, sans-serif`。不附带字体文件，也不要求购买商业字体。跨系统打开后若字体回退，请先确认字重、换行和标点，再导出。

## Logo

模板内使用仓库 `Vector.svg` 的准确图形路径；`reffo` 为可编辑工作字标。正式发布建议用仓库中的标准组合 Logo 替换整个工作字标组。不要直接把工作字标当成新的 Logo 母版。

## 导出

| 模板 | PNG 尺寸 | 颜色空间 |
|---|---:|---|
| 小红书封面/内页 | 1242×1660 | sRGB |
| 竖版视频封面 | 1080×1920 | sRGB |
| 横版文章头图 | 1920×1080 | sRGB |

发布副本可栅格化，但必须保留未转曲、可编辑的 SVG 源文件。
