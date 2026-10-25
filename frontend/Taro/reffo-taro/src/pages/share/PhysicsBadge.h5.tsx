import {View} from '@tarojs/components'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'

const GestureMotionView = View as unknown as ComponentType<any>

interface BadgePose {
  x: number
  y: number
  rotation: number
}

interface BadgeVelocity {
  x: number
  y: number
  rotation: number
}

interface PhysicsBadgeProps {
  children: ReactNode
}

const INITIAL_POSE: BadgePose = {x: 0, y: 0, rotation: 0}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getEventPoint(event: any) {
  const touch = event.touches?.[0] || event.changedTouches?.[0]
  return {
    x: touch?.clientX ?? event.clientX ?? 0,
    y: touch?.clientY ?? event.clientY ?? 0,
  }
}

export default function PhysicsBadge({children}: PhysicsBadgeProps) {
  const [pose, setPoseState] = useState<BadgePose>(INITIAL_POSE)
  const [isDragging, setIsDragging] = useState(false)
  const [isCapturing, setIsCapturing] = useState(true)
  const poseRef = useRef(INITIAL_POSE)
  const velocityRef = useRef<BadgeVelocity>({x: 0, y: 0, rotation: 0})
  const dragStartRef = useRef({pointer: {x: 0, y: 0}, pose: INITIAL_POSE})
  const frameRef = useRef<number | null>(null)

  const setPose = useCallback((next: BadgePose) => {
    poseRef.current = next
    setPoseState(next)
  }, [])

  const stopAnimation = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const settle = useCallback(() => {
    stopAnimation()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      velocityRef.current = {x: 0, y: 0, rotation: 0}
      setPose(INITIAL_POSE)
      return
    }

    const step = () => {
      const current = poseRef.current
      const velocity = velocityRef.current
      velocity.x = (velocity.x + (-current.x * 0.09)) * 0.82
      velocity.y = (velocity.y + (-current.y * 0.11)) * 0.8
      velocity.rotation = (velocity.rotation + (-current.rotation * 0.12)) * 0.78

      const next = {
        x: current.x + velocity.x,
        y: current.y + velocity.y,
        rotation: current.rotation + velocity.rotation,
      }
      setPose(next)

      const settled = Math.abs(next.x) < 0.08
        && Math.abs(next.y) < 0.08
        && Math.abs(next.rotation) < 0.08
      if (settled) {
        velocityRef.current = {x: 0, y: 0, rotation: 0}
        setPose(INITIAL_POSE)
        frameRef.current = null
        return
      }

      frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
  }, [setPose, stopAnimation])

  const startDrag = useCallback((event: any) => {
    if (event.button != null && event.button !== 0) return
    stopAnimation()
    const pointer = getEventPoint(event)
    dragStartRef.current = {pointer, pose: poseRef.current}
    velocityRef.current = {x: 0, y: 0, rotation: 0}
    setIsDragging(true)
    event.stopPropagation?.()
    event.preventDefault?.()
  }, [stopAnimation])

  const moveDrag = useCallback((event: any) => {
    event.stopPropagation?.()
    const pointer = getEventPoint(event)
    const start = dragStartRef.current
    const dx = pointer.x - start.pointer.x
    const dy = pointer.y - start.pointer.y
    const next = {
      x: clamp(start.pose.x + dx * 0.72, -110, 110),
      y: clamp(start.pose.y + dy * 0.24, -36, 82),
      rotation: clamp(start.pose.rotation + dx * 0.055, -15, 15),
    }
    velocityRef.current = {
      x: next.x - poseRef.current.x,
      y: next.y - poseRef.current.y,
      rotation: next.rotation - poseRef.current.rotation,
    }
    setPose(next)
    event.preventDefault?.()
  }, [setPose])

  const endDrag = useCallback((event?: any) => {
    event?.stopPropagation?.()
    setIsDragging(false)
    settle()
  }, [settle])

  useEffect(() => {
    const timer = window.setTimeout(() => setIsCapturing(false), 1040)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    window.addEventListener('mousemove', moveDrag)
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('touchmove', moveDrag, {passive: false})
    window.addEventListener('touchend', endDrag)
    window.addEventListener('touchcancel', endDrag)

    return () => {
      window.removeEventListener('mousemove', moveDrag)
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('touchmove', moveDrag)
      window.removeEventListener('touchend', endDrag)
      window.removeEventListener('touchcancel', endDrag)
    }
  }, [endDrag, isDragging, moveDrag])

  useEffect(() => () => stopAnimation(), [stopAnimation])

  const ropeEndX = 160 + pose.x * 0.88
  const ropeEndY = 155 + pose.y

  return (
    <View className={`share-physics ${isDragging ? 'share-physics--dragging' : ''} ${isCapturing ? 'share-physics--capturing' : ''}`}>
      <svg
        className='share-physics__rope'
        viewBox='0 0 320 190'
        aria-hidden='true'
      >
        <path
          d={`M160 0 C ${160 + pose.x * 0.12} 58, ${160 + pose.x * 0.68} 112, ${ropeEndX} ${ropeEndY}`}
          fill='none'
          stroke='rgba(255,255,255,0.92)'
          strokeWidth='13'
          strokeLinecap='round'
        />
        <path
          d={`M160 0 C ${160 + pose.x * 0.12} 58, ${160 + pose.x * 0.68} 112, ${ropeEndX} ${ropeEndY}`}
          fill='none'
          stroke='rgba(112,124,132,0.52)'
          strokeWidth='2'
          strokeLinecap='round'
        />
      </svg>

      <GestureMotionView
        className='share-physics__motion'
        style={{
          transform: `translateX(-50%) translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rotation}deg)`,
          '--share-pose-x': `${pose.x}px`,
          '--share-pose-y': `${pose.y}px`,
          '--share-pose-rotation': `${pose.rotation}deg`,
        } as any}
        onTouchStart={startDrag}
        onTouchMove={moveDrag}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        onMouseDown={startDrag}
      >
        <View className='share-physics__capture'>
          <View className='share-physics__clip'>
            <View className='share-physics__clip-hook' />
            <View className='share-physics__clip-slot' />
          </View>
          <View className='share-physics__badge'>
            {children}
          </View>
        </View>
      </GestureMotionView>
    </View>
  )
}
