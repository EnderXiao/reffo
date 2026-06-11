module.exports = {
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  transform: {
    '^.+\\.(ts|tsx)$': ['babel-jest', {configFile: './babel.config.js'}],
    '^.+\\.(js|jsx)$': ['babel-jest', {configFile: './babel.config.js'}],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(png|jpg|jpeg|gif|webp|svg)$': '<rootDir>/src/__mocks__/fileMock.js',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.tsx',
    '^react-native-gesture-handler$': '<rootDir>/src/__mocks__/react-native-gesture-handler.tsx',
    '^@tarojs/taro$': '<rootDir>/src/__mocks__/@tarojs/taro.ts',
    '^@tarojs/components$': '<rootDir>/src/__mocks__/@tarojs/components.tsx',
    '^react-native-svg$': '<rootDir>/src/__mocks__/react-native-svg.tsx',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  // 转换 @tarojs 和 zustand 包
  transformIgnorePatterns: [
    'node_modules/(?!(@tarojs|zustand|@testing-library)/)',
  ],
};
