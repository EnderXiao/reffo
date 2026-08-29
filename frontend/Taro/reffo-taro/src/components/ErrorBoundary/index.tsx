import {Component, ReactNode} from 'react';
import {View, Text} from '@tarojs/components';
import {Button} from '@/components';
import {navigation} from '@/utils/navigation';
import {routePaths} from '@/shared/routing';
import styles from './index.module.scss';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

/**
 * 全局错误边界组件
 *
 * **验证需求: Requirement 9.1**
 * - 捕获组件树中的 JavaScript 错误
 * - 显示友好的错误 UI
 * - 提供错误恢复机制
 * - 记录错误信息用于调试
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * 当子组件抛出错误时调用
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * 捕获错误详细信息
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] 捕获到错误:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    this.setState({
      errorInfo: errorInfo.componentStack || null,
    });

    // 可以在这里上报错误到监控系统
    // reportError(error, errorInfo);
  }

  /**
   * 重置错误状态
   */
  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /**
   * 刷新页面
   */
  handleReload = () => {
    void navigation.reLaunch(routePaths.home);
  };

  render() {
    const {hasError, error} = this.state;
    const {children, fallback} = this.props;

    if (hasError) {
      // 如果提供了自定义 fallback，使用它
      if (fallback) {
        return fallback;
      }

      // 默认错误 UI
      return (
        <View className={styles.container}>
          <View className={styles.content}>
            <View className={styles.icon}>⚠️</View>
            <Text className={styles.title}>出错了</Text>
            <Text className={styles.message}>
              {error?.message || '应用遇到了一个错误'}
            </Text>

            <View className={styles.actions}>
              <Button
                type="primary"
                size="medium"
                onClick={this.handleReset}
                className={styles.button}
              >
                重试
              </Button>
              <Button
                type="secondary"
                size="medium"
                onClick={this.handleReload}
                className={styles.button}
              >
                刷新页面
              </Button>
            </View>

            {process.env.NODE_ENV === 'development' && error && (
              <View className={styles.debug}>
                <Text className={styles.debugTitle}>调试信息：</Text>
                <Text className={styles.debugText}>{error.stack}</Text>
              </View>
            )}
          </View>
        </View>
      );
    }

    return children;
  }
}
