// Jest setup file
// 在这里可以添加全局的测试配置

// 设置测试超时时间
jest.setTimeout(10000);

// Mock console 方法以减少测试输出噪音（可选）
global.console = {
  ...console,
  // 保留 error 和 warn，但可以静默 log
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
};
