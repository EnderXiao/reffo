import {useState} from 'react';
import Taro from '@tarojs/taro';
import {Button, Input, Text, View} from '@tarojs/components';
import {useAuthStore} from '@/store/authStore';

import './index.scss';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const loading = useAuthStore(state => state.loading);
  const error = useAuthStore(state => state.error);
  const session = useAuthStore(state => state.session);
  const signInWithPassword = useAuthStore(state => state.signInWithPassword);
  const signOut = useAuthStore(state => state.signOut);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      Taro.showToast({title: '请输入邮箱和密码', icon: 'none'});
      return;
    }

    try {
      await signInWithPassword({email: email.trim(), password});
      Taro.showToast({title: '已登录', icon: 'success'});
      const pages = Taro.getCurrentPages();

      if (pages.length > 1) {
        Taro.navigateBack();
      } else {
        Taro.switchTab?.({url: '/pages/index/index'}).catch(() => {
          Taro.redirectTo({url: '/pages/index/index'});
        });
      }
    } catch {
      Taro.showToast({title: '登录失败', icon: 'none'});
    }
  };

  const handleSignOut = async () => {
    await signOut();
    Taro.showToast({title: '已退出', icon: 'success'});
  };

  return (
    <View className='reffo-auth'>
      <View className='reffo-auth__header'>
        <Text className='reffo-auth__title'>登录 Reffo</Text>
        <Text className='reffo-auth__subtitle'>同步源简历和生成历史</Text>
      </View>

      {session ? (
        <View className='reffo-auth__panel'>
          <Text className='reffo-auth__label'>当前账号</Text>
          <Text className='reffo-auth__email'>{session.user.email || session.user.id}</Text>
          <Button className='reffo-auth__secondary' loading={loading} onClick={handleSignOut}>
            退出登录
          </Button>
        </View>
      ) : (
        <View className='reffo-auth__panel'>
          <Text className='reffo-auth__label'>邮箱</Text>
          <Input
            className='reffo-auth__input'
            value={email}
            type='text'
            placeholder='name@example.com'
            onInput={event => setEmail(String(event.detail.value || ''))}
          />
          <Text className='reffo-auth__label'>密码</Text>
          <Input
            className='reffo-auth__input'
            value={password}
            password
            placeholder='输入密码'
            onInput={event => setPassword(String(event.detail.value || ''))}
          />
          {error ? <Text className='reffo-auth__error'>{error}</Text> : null}
          <Button className='reffo-auth__primary' loading={loading} onClick={handleSubmit}>
            登录
          </Button>
        </View>
      )}
    </View>
  );
}
