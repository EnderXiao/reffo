// Jest setup file
// 在这里可以添加全局的测试配置

// 设置测试超时时间
jest.setTimeout(10000);

// jsdom 不提供 Canvas 渲染能力，返回 null 让视觉能力检测走正常降级路径。
HTMLCanvasElement.prototype.getContext = jest.fn(() => null);

// Mock console 方法以减少测试输出噪音（可选）
global.console = {
  ...console,
  // 保留 error 和 warn，但可以静默 log
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
};
