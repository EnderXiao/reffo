import {useEffect, useMemo, useRef, useState} from 'react'
import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import DeleteBreakCard, {type DeleteBreakCardShardConfig} from '@/components/business/DeleteBreakCard/index.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import '@/pages/index/index.h5.scss'
import './index.h5.scss'

interface DeleteCardBreakParams {
  planeRotationDeg: number
  planeDirectionRotationDeg: number
  diagonalRotationDeg: number
  topBendDeg: number
  bottomBendDeg: number
  topTwistDeg: number
  bottomTwistDeg: number
  topOffsetY: number
  bottomOffsetY: number
  topOffsetZ: number
  bottomOffsetZ: number
  thickness: number
  layDurationMs: number
  waitDurationMs: number
  shakeDurationMs: number
  breakDurationMs: number
  layEaseX1: number
  layEaseY1: number
  layEaseX2: number
  layEaseY2: number
  shakeEaseX1: number
  shakeEaseY1: number
  shakeEaseX2: number
  shakeEaseY2: number
  breakEaseX1: number
  breakEaseY1: number
  breakEaseX2: number
  breakEaseY2: number
  pieceFallEaseX1: number
  pieceFallEaseY1: number
  pieceFallEaseX2: number
  pieceFallEaseY2: number
  shardCount: number
  shardGroupLeftPct: number
  shardGroupTopPct: number
  shardMinWidth: number
  shardMaxWidth: number
  shardMinHeight: number
  shardMaxHeight: number
  shardStartSpread: number
  shardMinTravel: number
  shardMaxTravel: number
  shardMinDurationMs: number
  shardMaxDurationMs: number
  shardMaxDelayMs: number
}

type DeleteBreakDebugPhase = 'idle' | 'laying' | 'waiting' | 'breaking'

const DEFAULT_DELETE_CARD_BREAK_PARAMS: DeleteCardBreakParams = {
  planeRotationDeg: -120,
  planeDirectionRotationDeg: 50,
  diagonalRotationDeg: -91,
  topBendDeg: 28,
  bottomBendDeg: -18,
  topTwistDeg: 2,
  bottomTwistDeg: 2,
  topOffsetY: -0.36,
  bottomOffsetY: 0.37,
  topOffsetZ: -0.18,
  bottomOffsetZ: -0.16,
  thickness: 0.04,
  layDurationMs: 620,
  waitDurationMs: 2000,
  shakeDurationMs: 520,
  breakDurationMs: 1180,
  layEaseX1: 0.18,
  layEaseY1: 0.92,
  layEaseX2: 0.22,
  layEaseY2: 1,
  shakeEaseX1: 0.46,
  shakeEaseY1: 0,
  shakeEaseX2: 0.58,
  shakeEaseY2: 1,
  breakEaseX1: 0.16,
  breakEaseY1: 1,
  breakEaseX2: 0.24,
  breakEaseY2: 1,
  pieceFallEaseX1: 0.22,
  pieceFallEaseY1: 0.74,
  pieceFallEaseX2: 0.18,
  pieceFallEaseY2: 1,
  shardCount: 18,
  shardGroupLeftPct: 61,
  shardGroupTopPct: 49,
  shardMinWidth: 14,
  shardMaxWidth: 32,
  shardMinHeight: 2,
  shardMaxHeight: 3,
  shardStartSpread: 18,
  shardMinTravel: 42,
  shardMaxTravel: 112,
  shardMinDurationMs: 280,
  shardMaxDurationMs: 500,
  shardMaxDelayMs: 80,
}

const DEBUG_CARD: HomeCardItem = {
  id: 'debug-delete-card',
  company: '字节跳动',
  indexLabel: 'B',
  location: '上海',
  role: '产品设计师',
  dateLabel: '2026.07',
  score: 93,
  primaryColor: '#ff5a3c',
  surfaceColor: '#fff4ed',
  stackColor: '#ffd9c9',
  logoColor: '#ef4d2f',
  borderColor: 'rgba(255, 95, 62, 0.26)',
  tone: 'warm',
  strategyBody: '突出增长、协作与 AI 产品落地经验。',
}

type DeleteCardBreakParamControl = {
  key: keyof DeleteCardBreakParams
  label: string
  min: number
  max: number
  step: number
  unit: string
}

const MOTION_PARAM_CONTROLS: DeleteCardBreakParamControl[] = [
  {key: 'planeRotationDeg', label: '平面旋转', min: -120, max: 120, step: 1, unit: 'deg'},
  {key: 'planeDirectionRotationDeg', label: '平面方向3D旋转', min: -120, max: 120, step: 1, unit: 'deg'},
  {key: 'diagonalRotationDeg', label: '对角线深度旋转', min: -120, max: 120, step: 1, unit: 'deg'},
  {key: 'topBendDeg', label: '上半掰开角', min: -90, max: 90, step: 1, unit: 'deg'},
  {key: 'bottomBendDeg', label: '下半掰开角', min: -90, max: 90, step: 1, unit: 'deg'},
  {key: 'topTwistDeg', label: '上半平面偏转', min: -45, max: 45, step: 1, unit: 'deg'},
  {key: 'bottomTwistDeg', label: '下半平面偏转', min: -45, max: 45, step: 1, unit: 'deg'},
  {key: 'topOffsetY', label: '上半纵向位移', min: -0.8, max: 0.8, step: 0.01, unit: ''},
  {key: 'bottomOffsetY', label: '下半纵向位移', min: -0.8, max: 0.8, step: 0.01, unit: ''},
  {key: 'topOffsetZ', label: '上半前后位移', min: -0.8, max: 0.8, step: 0.01, unit: ''},
  {key: 'bottomOffsetZ', label: '下半前后位移', min: -0.8, max: 0.8, step: 0.01, unit: ''},
  {key: 'thickness', label: '厚度', min: 0.04, max: 0.32, step: 0.01, unit: ''},
  {key: 'layDurationMs', label: '铺平时长', min: 120, max: 2000, step: 10, unit: 'ms'},
  {key: 'waitDurationMs', label: '等待时长', min: 0, max: 5000, step: 50, unit: 'ms'},
  {key: 'shakeDurationMs', label: '等待抖动周期', min: 120, max: 1600, step: 10, unit: 'ms'},
  {key: 'breakDurationMs', label: '断裂淡出时长', min: 240, max: 3000, step: 10, unit: 'ms'},
  {key: 'layEaseX1', label: '铺平曲线 x1', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'layEaseY1', label: '铺平曲线 y1', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'layEaseX2', label: '铺平曲线 x2', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'layEaseY2', label: '铺平曲线 y2', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'shakeEaseX1', label: '抖动曲线 x1', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'shakeEaseY1', label: '抖动曲线 y1', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'shakeEaseX2', label: '抖动曲线 x2', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'shakeEaseY2', label: '抖动曲线 y2', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'breakEaseX1', label: '断裂曲线 x1', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'breakEaseY1', label: '断裂曲线 y1', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'breakEaseX2', label: '断裂曲线 x2', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'breakEaseY2', label: '断裂曲线 y2', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'pieceFallEaseX1', label: '两片掉落曲线 x1', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'pieceFallEaseY1', label: '两片掉落曲线 y1', min: -1, max: 2, step: 0.01, unit: ''},
  {key: 'pieceFallEaseX2', label: '两片掉落曲线 x2', min: 0, max: 1, step: 0.01, unit: ''},
  {key: 'pieceFallEaseY2', label: '两片掉落曲线 y2', min: -1, max: 2, step: 0.01, unit: ''},
]

const SHARD_PARAM_CONTROLS: DeleteCardBreakParamControl[] = [
  {key: 'shardCount', label: '碎片数量', min: 4, max: 28, step: 1, unit: ''},
  {key: 'shardGroupLeftPct', label: '碎片基准X', min: 35, max: 65, step: 0.5, unit: '%'},
  {key: 'shardGroupTopPct', label: '碎片基准Y', min: 35, max: 62, step: 0.5, unit: '%'},
  {key: 'shardMinWidth', label: '线条最小宽', min: 6, max: 42, step: 1, unit: 'px'},
  {key: 'shardMaxWidth', label: '线条最大宽', min: 8, max: 56, step: 1, unit: 'px'},
  {key: 'shardMinHeight', label: '线条最小高', min: 1, max: 8, step: 0.5, unit: 'px'},
  {key: 'shardMaxHeight', label: '线条最大高', min: 1.5, max: 10, step: 0.5, unit: 'px'},
  {key: 'shardStartSpread', label: '起点散布', min: 0, max: 42, step: 1, unit: 'px'},
  {key: 'shardMinTravel', label: '最小飞散距离', min: 12, max: 120, step: 1, unit: 'px'},
  {key: 'shardMaxTravel', label: '最大飞散距离', min: 20, max: 180, step: 1, unit: 'px'},
  {key: 'shardMinDurationMs', label: '最短飞散时长', min: 120, max: 800, step: 10, unit: 'ms'},
  {key: 'shardMaxDurationMs', label: '最长飞散时长', min: 160, max: 1000, step: 10, unit: 'ms'},
  {key: 'shardMaxDelayMs', label: '最大随机延迟', min: 0, max: 220, step: 5, unit: 'ms'},
]

function formatParamValue(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2)
}

export default function DeleteBreakDebugPage() {
  const [replayKey, setReplayKey] = useState(0)
  const [phase, setPhase] = useState<DeleteBreakDebugPhase>('idle')
  const [isPaused, setIsPaused] = useState(false)
  const [params, setParams] = useState<DeleteCardBreakParams>(DEFAULT_DELETE_CARD_BREAK_PARAMS)
  const activeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerDeadlineRef = useRef(0)
  const timerRemainingRef = useRef(0)
  const nextPhaseRef = useRef<DeleteBreakDebugPhase | null>(null)
  const card = useMemo(() => DEBUG_CARD, [])
  const serializedParams = useMemo(() => JSON.stringify(params, null, 2), [params])
  const shardConfig = useMemo<DeleteBreakCardShardConfig>(() => ({
    count: params.shardCount,
    minWidth: Math.min(params.shardMinWidth, params.shardMaxWidth),
    maxWidth: Math.max(params.shardMinWidth, params.shardMaxWidth),
    minHeight: Math.min(params.shardMinHeight, params.shardMaxHeight),
    maxHeight: Math.max(params.shardMinHeight, params.shardMaxHeight),
    startSpread: params.shardStartSpread,
    minTravel: Math.min(params.shardMinTravel, params.shardMaxTravel),
    maxTravel: Math.max(params.shardMinTravel, params.shardMaxTravel),
    minDurationMs: Math.min(params.shardMinDurationMs, params.shardMaxDurationMs),
    maxDurationMs: Math.max(params.shardMinDurationMs, params.shardMaxDurationMs),
    maxDelayMs: params.shardMaxDelayMs,
  }), [params])
  const sceneStyle = {
    '--delete-break-card-width': '218px',
    '--delete-break-card-height': '337px',
    '--card-design-width': '218px',
    '--card-design-height': '337px',
    '--card-responsive-scale': '1',
    '--delete-break-card-plane-rotation': `${params.planeRotationDeg}deg`,
    '--delete-break-card-direction-rotation': `${params.planeDirectionRotationDeg}deg`,
    '--delete-break-card-diagonal-rotation': `${params.diagonalRotationDeg}deg`,
    '--delete-break-card-top-bend': `${params.topBendDeg}deg`,
    '--delete-break-card-bottom-bend': `${params.bottomBendDeg}deg`,
    '--delete-break-card-top-twist': `${params.topTwistDeg}deg`,
    '--delete-break-card-bottom-twist': `${params.bottomTwistDeg}deg`,
    '--delete-break-card-top-y': `${params.topOffsetY * 100}px`,
    '--delete-break-card-top-y-mid': `${params.topOffsetY * 50}px`,
    '--delete-break-card-bottom-y': `${params.bottomOffsetY * 100}px`,
    '--delete-break-card-bottom-y-mid': `${params.bottomOffsetY * 50}px`,
    '--delete-break-card-top-z': `${params.topOffsetZ * 100}px`,
    '--delete-break-card-top-z-mid': `${params.topOffsetZ * 50}px`,
    '--delete-break-card-bottom-z': `${params.bottomOffsetZ * 100}px`,
    '--delete-break-card-bottom-z-mid': `${params.bottomOffsetZ * 50}px`,
    '--delete-break-card-top-bend-mid': `${params.topBendDeg * 0.5}deg`,
    '--delete-break-card-bottom-bend-mid': `${params.bottomBendDeg * 0.5}deg`,
    '--delete-break-card-top-twist-mid': `${params.topTwistDeg * 0.5}deg`,
    '--delete-break-card-bottom-twist-mid': `${params.bottomTwistDeg * 0.5}deg`,
    '--delete-break-card-thickness': `${Math.max(1, params.thickness * 100)}px`,
    '--delete-break-card-lay-duration': `${params.layDurationMs}ms`,
    '--delete-break-card-wait-duration': `${params.waitDurationMs}ms`,
    '--delete-break-card-break-duration': `${params.breakDurationMs}ms`,
    '--delete-break-card-lay-ease': `cubic-bezier(${params.layEaseX1}, ${params.layEaseY1}, ${params.layEaseX2}, ${params.layEaseY2})`,
    '--delete-break-card-shake-ease': `cubic-bezier(${params.shakeEaseX1}, ${params.shakeEaseY1}, ${params.shakeEaseX2}, ${params.shakeEaseY2})`,
    '--delete-break-card-break-ease': `cubic-bezier(${params.breakEaseX1}, ${params.breakEaseY1}, ${params.breakEaseX2}, ${params.breakEaseY2})`,
    '--delete-break-card-piece-fall-ease': `cubic-bezier(${params.pieceFallEaseX1}, ${params.pieceFallEaseY1}, ${params.pieceFallEaseX2}, ${params.pieceFallEaseY2})`,
    '--delete-break-card-shard-group-left': `${params.shardGroupLeftPct}%`,
    '--delete-break-card-shard-group-top': `${params.shardGroupTopPct}%`,
  } as any

  const clearTimers = () => {
    if (activeTimerRef.current != null) {
      clearTimeout(activeTimerRef.current)
      activeTimerRef.current = null
    }
    timerDeadlineRef.current = 0
    timerRemainingRef.current = 0
    nextPhaseRef.current = null
  }

  useEffect(() => clearTimers, [])

  const advanceToPhase = (nextPhase: DeleteBreakDebugPhase) => {
    setPhase(nextPhase)
    if (nextPhase === 'waiting') {
      schedulePhaseTransition('breaking', params.waitDurationMs)
    }
  }

  function schedulePhaseTransition(nextPhase: DeleteBreakDebugPhase, delay: number) {
    clearTimers()
    nextPhaseRef.current = nextPhase
    timerRemainingRef.current = delay
    timerDeadlineRef.current = Date.now() + delay
    activeTimerRef.current = setTimeout(() => {
      activeTimerRef.current = null
      timerDeadlineRef.current = 0
      timerRemainingRef.current = 0
      nextPhaseRef.current = null
      advanceToPhase(nextPhase)
    }, delay)
  }

  const updateParam = (key: keyof DeleteCardBreakParams, value: number) => {
    setParams(current => ({
      ...current,
      [key]: value,
    }))
  }

  const startPlayback = () => {
    clearTimers()
    setReplayKey(value => value + 1)
    setIsPaused(false)
    setPhase('laying')
    schedulePhaseTransition('waiting', params.layDurationMs)
  }

  const resetPlayback = () => {
    clearTimers()
    setPhase('idle')
    setIsPaused(false)
    setReplayKey(value => value + 1)
  }

  const togglePause = () => {
    if (phase === 'idle') {
      return
    }

    if (isPaused) {
      setIsPaused(false)
      if (nextPhaseRef.current != null && timerRemainingRef.current > 0) {
        schedulePhaseTransition(nextPhaseRef.current, timerRemainingRef.current)
      }
      return
    }

    setIsPaused(true)
    if (activeTimerRef.current != null) {
      timerRemainingRef.current = Math.max(timerDeadlineRef.current - Date.now(), 0)
      clearTimeout(activeTimerRef.current)
      activeTimerRef.current = null
    }
  }

  const renderControl = (control: DeleteCardBreakParamControl) => (
    <View className='reffo-delete-break-debug__control' key={control.key}>
      <View className='reffo-delete-break-debug__control-head'>
        <Text className='reffo-delete-break-debug__control-label'>{control.label}</Text>
        <Text className='reffo-delete-break-debug__control-value'>
          {formatParamValue(params[control.key])}
          {control.unit}
        </Text>
      </View>
      <input
        className='reffo-delete-break-debug__slider'
        type='range'
        min={control.min}
        max={control.max}
        step={control.step}
        value={params[control.key]}
        onChange={event => updateParam(control.key, Number(event.currentTarget.value))}
      />
    </View>
  )

  return (
    <View
      className={classNames('reffo-delete-break-debug', {
        'reffo-delete-break-debug--breaking': phase === 'breaking',
        'reffo-delete-break-debug--paused': isPaused,
      })}
    >
      <View className='reffo-delete-break-debug__workspace'>
        <View className='reffo-delete-break-debug__stage'>
          <DeleteBreakCard
            key={replayKey}
            card={card}
            phase={phase}
            visualTier='enhanced'
            paused={isPaused}
            className='reffo-delete-break-debug__dom-scene'
            cardClassName='reffo-delete-break-debug__home-card'
            style={sceneStyle}
            shardConfig={shardConfig}
          />
        </View>

        <View className='reffo-delete-break-debug__panel'>
          <View className='reffo-delete-break-debug__panel-head'>
            <Text className='reffo-delete-break-debug__panel-title'>参数</Text>
            <View
              className='reffo-delete-break-debug__panel-reset'
              role='button'
              onClick={() => {
                setParams(DEFAULT_DELETE_CARD_BREAK_PARAMS)
              }}
            >
              <Text>参数重置</Text>
            </View>
          </View>

          <View className='reffo-delete-break-debug__controls'>
            <View className='reffo-delete-break-debug__control-section'>
              <View className='reffo-delete-break-debug__section-head'>
                <Text className='reffo-delete-break-debug__section-title'>卡片断裂参数</Text>
              </View>
              {MOTION_PARAM_CONTROLS.map(renderControl)}
            </View>

            <View className='reffo-delete-break-debug__control-section reffo-delete-break-debug__control-section--shards'>
              <View className='reffo-delete-break-debug__section-head'>
                <Text className='reffo-delete-break-debug__section-title'>梯形碎片参数</Text>
              </View>
              {SHARD_PARAM_CONTROLS.map(renderControl)}
            </View>
          </View>

          <textarea className='reffo-delete-break-debug__json' readOnly value={serializedParams} />
        </View>
      </View>

      <View className='reffo-delete-break-debug__toolbar'>
        <View
          className='reffo-delete-break-debug__button'
          role='button'
          onClick={startPlayback}
        >
          <Text>{phase === 'idle' ? '播放' : '重播'}</Text>
        </View>
        <View
          className={classNames('reffo-delete-break-debug__button', {
            'reffo-delete-break-debug__button--disabled': phase === 'idle',
          })}
          role='button'
          aria-disabled={phase === 'idle'}
          onClick={togglePause}
        >
          <Text>{isPaused ? '继续' : '暂停'}</Text>
        </View>
        <View
          className='reffo-delete-break-debug__button'
          role='button'
          onClick={resetPlayback}
        >
          <Text>Reset</Text>
        </View>
      </View>
    </View>
  )
}
