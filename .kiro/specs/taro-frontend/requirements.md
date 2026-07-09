# Requirements Document - Taro 前端重构

## Introduction

本文档定义了 Reffo 项目从 Web MVP 版本升级到 0.1 版本的前端重构需求。该重构将采用 Taro 框架构建跨平台应用，首先支持 iOS 平台，后续扩展到小程序和 Web 平台。

## Glossary

- **Taro**: 多端统一开发框架，支持编译到 iOS、Android、小程序、H5 等平台
- **Taro_Native_Shell**: Taro 官方提供的原生壳工程，用于加载 Taro 代码
- **分离模式**: Taro 应用代码与原生壳分离部署的模式
- **兼容层**: 对 Taro API 进行封装，处理不同平台的差异性
- **Frontend_App**: 基于 Taro 构建的前端应用
- **Design_System**: 基于 Figma 设计稿的 UI 组件系统
- **Backend_API**: 现有的后端 API 服务（Elysia + Bun）

## Requirements

### Requirement 1: Taro 项目初始化

**User Story:** 作为开发者，我希望初始化一个 Taro 项目，以便开始跨平台应用开发。

#### Acceptance Criteria

1. THE Frontend_App SHALL 使用 Taro 3.6+ 版本初始化项目
2. THE Frontend_App SHALL 配置 TypeScript 5.0+ 作为开发语言
3. THE Frontend_App SHALL 配置 React 18+ 作为 UI 框架
4. THE Frontend_App SHALL 包含 iOS、小程序、H5 三个编译目标配置
5. THE Frontend_App SHALL 使用分离模式配置，支持独立部署

### Requirement 2: 原生壳集成

**User Story:** 作为开发者，我希望集成 Taro Native Shell，以便在 iOS 设备上运行应用。

#### Acceptance Criteria

1. THE Frontend_App SHALL 集成 Taro Native Shell 作为 iOS 原生壳
2. WHEN 应用启动时，THE Native_Shell SHALL 加载 Taro 编译产物
3. THE Native_Shell SHALL 支持热更新机制
4. THE Native_Shell SHALL 配置应用图标、启动页和基础信息
5. THE Native_Shell SHALL 支持本地开发调试模式

### Requirement 3: 平台兼容层

**User Story:** 作为开发者，我希望有一个统一的 API 兼容层，以便在不同平台上使用一致的接口。

#### Acceptance Criteria

1. THE Frontend_App SHALL 实现平台兼容层模块
2. THE Compatibility_Layer SHALL 封装 Taro API，提供统一接口
3. WHEN 调用存储 API 时，THE Compatibility_Layer SHALL 根据平台选择合适的实现
4. WHEN 调用网络请求 API 时，THE Compatibility_Layer SHALL 处理不同平台的差异
5. WHEN 调用导航 API 时，THE Compatibility_Layer SHALL 适配不同平台的路由机制
6. THE Compatibility_Layer SHALL 提供平台检测工具函数
7. THE Compatibility_Layer SHALL 记录平台差异处理日志

### Requirement 4: 首页实现

**User Story:** 作为用户，我希望看到一个美观的首页，以便开始使用简历优化功能。

#### Acceptance Criteria

1. THE Frontend_App SHALL 根据 Figma 设计稿实现首页 UI
2. THE Home_Page SHALL 包含应用标题和品牌标识
3. THE Home_Page SHALL 包含简历上传/输入入口
4. THE Home_Page SHALL 包含 JD 输入入口
5. THE Home_Page SHALL 包含开始优化按钮
6. THE Home_Page SHALL 在不同屏幕尺寸下保持良好布局
7. WHEN 用户点击上传按钮时，THE Home_Page SHALL 打开文件选择器
8. WHEN 用户点击开始优化时，THE Home_Page SHALL 验证输入完整性

### Requirement 5: 设计系统

**User Story:** 作为开发者，我希望有一套统一的设计系统，以便快速构建一致的 UI。

#### Acceptance Criteria

1. THE Frontend_App SHALL 定义颜色系统（主色、辅助色、状态色）
2. THE Frontend_App SHALL 定义字体系统（字号、字重、行高）
3. THE Frontend_App SHALL 定义间距系统（padding、margin、gap）
4. THE Frontend_App SHALL 实现基础组件库（Button、Input、Card）
5. THE Design_System SHALL 支持主题切换（浅色/深色模式）
6. THE Design_System SHALL 使用 CSS Variables 管理设计 token
7. THE Design_System SHALL 提供组件使用文档

### Requirement 6: 状态管理

**User Story:** 作为开发者，我希望有统一的状态管理方案，以便管理应用数据流。

#### Acceptance Criteria

1. THE Frontend_App SHALL 使用 Zustand 或 Redux 进行全局状态管理
2. THE State_Manager SHALL 管理用户输入数据（简历、JD）
3. THE State_Manager SHALL 管理 API 请求状态（loading、error、data）
4. THE State_Manager SHALL 持久化关键数据到本地存储
5. WHEN 应用重启时，THE State_Manager SHALL 恢复上次的状态

### Requirement 7: API 集成

**User Story:** 作为用户，我希望应用能调用后端 API，以便获得简历优化服务。

#### Acceptance Criteria

1. THE Frontend_App SHALL 集成现有的后端 API（http://localhost:3000/api/v1）
2. THE API_Client SHALL 封装所有 API 调用
3. WHEN 调用 API 时，THE API_Client SHALL 处理请求超时
4. WHEN API 返回错误时，THE API_Client SHALL 提供友好的错误提示
5. THE API_Client SHALL 支持请求重试机制
6. THE API_Client SHALL 记录 API 调用日志

### Requirement 8: 路由配置

**User Story:** 作为开发者，我希望配置应用路由，以便支持多页面导航。

#### Acceptance Criteria

1. THE Frontend_App SHALL 配置 Taro 路由系统
2. THE Router SHALL 定义首页路由（/pages/index/index）
3. THE Router SHALL 定义结果页路由（/pages/result/index）
4. THE Router SHALL 支持页面间参数传递
5. THE Router SHALL 支持页面返回和前进导航

### Requirement 9: 错误处理

**User Story:** 作为用户，我希望在出错时看到清晰的提示，以便了解问题并采取行动。

#### Acceptance Criteria

1. THE Frontend_App SHALL 实现全局错误边界
2. WHEN 网络错误发生时，THE Error_Handler SHALL 显示网络错误提示
3. WHEN API 错误发生时，THE Error_Handler SHALL 显示具体错误信息
4. WHEN 输入验证失败时，THE Error_Handler SHALL 高亮错误字段
5. THE Error_Handler SHALL 提供错误恢复建议

### Requirement 10: 性能优化

**User Story:** 作为用户，我希望应用响应迅速，以便获得流畅的使用体验。

#### Acceptance Criteria

1. THE Frontend_App SHALL 实现代码分割和懒加载
2. THE Frontend_App SHALL 优化图片资源（压缩、懒加载）
3. THE Frontend_App SHALL 缓存 API 响应数据
4. WHEN 页面首次加载时，THE Frontend_App SHALL 在 3 秒内完成渲染
5. THE Frontend_App SHALL 使用虚拟列表优化长列表渲染

### Requirement 11: 开发工具配置

**User Story:** 作为开发者，我希望配置开发工具，以便提高开发效率。

#### Acceptance Criteria

1. THE Frontend_App SHALL 配置 ESLint 进行代码检查
2. THE Frontend_App SHALL 配置 Prettier 进行代码格式化
3. THE Frontend_App SHALL 配置 TypeScript 严格模式
4. THE Frontend_App SHALL 配置 Git hooks 进行提交前检查
5. THE Frontend_App SHALL 提供开发、测试、生产三种环境配置

### Requirement 12: 构建和部署

**User Story:** 作为开发者，我希望配置构建流程，以便将应用部署到不同平台。

#### Acceptance Criteria

1. THE Frontend_App SHALL 支持编译到 iOS 平台
2. THE Frontend_App SHALL 支持编译到微信小程序平台
3. THE Frontend_App SHALL 支持编译到 H5 平台
4. THE Build_System SHALL 生成优化的生产构建产物
5. THE Build_System SHALL 支持环境变量配置
6. THE Build_System SHALL 生成 source map 用于调试
