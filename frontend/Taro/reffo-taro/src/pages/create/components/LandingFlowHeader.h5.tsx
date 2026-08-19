import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import './LandingFlowHeader.h5.scss'

interface LandingFlowHeaderProps {
  onBack: () => void
  onSkip: () => Promise<void> | void
  progressStep?: 1 | 2 | 3
  backLabel?: string
  className?: string
}

export default function LandingFlowHeader({
  onBack,
  onSkip,
  progressStep = 2,
  backLabel = '返回',
  className,
}: LandingFlowHeaderProps) {
  return (
    <View className={classNames('reffo-create__landing-header', className)}>
      <View className='reffo-create__landing-skip' onClick={() => void onSkip()} role='button'>
        <Text>跳过教程</Text>
      </View>
      <View
        className={classNames('reffo-create__landing-progress', `reffo-create__landing-progress--step-${progressStep}`)}
        aria-label={`教程进度，第${progressStep}步`}
        role='img'
      >
        {([1, 2, 3] as const).map(step => (
          <View
            key={step}
            className={classNames('reffo-create__landing-progress-segment', {
              'reffo-create__landing-progress-segment--active': step === progressStep,
            })}
          />
        ))}
      </View>
      <View className='reffo-create__landing-back' onClick={onBack} role='button'>
        <Text>{backLabel}</Text>
      </View>
    </View>
  )
}
