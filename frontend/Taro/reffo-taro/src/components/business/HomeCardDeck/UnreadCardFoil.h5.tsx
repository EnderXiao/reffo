import {useEffect, useRef} from 'react'
import type {VisualTier} from '@/utils/visual-tier'
import './task-card.h5.scss'

export default function UnreadCardFoil({active, tier}: {active: boolean; tier: VisualTier}) {
  const foilRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const foil = foilRef.current
    const card = foil?.closest<HTMLElement>('[data-home-card-id]')
    if (!foil || !card || !active || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    let frame = 0
    let pointerX = 0.5
    let pointerY = 0.4
    const update = () => {
      frame = 0
      const pointerDistance = Math.min(1, Math.hypot(pointerX - 0.5, pointerY - 0.4) / 0.72)
      foil.style.setProperty('--foil-x', `${(pointerX * 100).toFixed(1)}%`)
      foil.style.setProperty('--foil-y', `${(pointerY * 100).toFixed(1)}%`)
      foil.style.setProperty('--foil-angle', `${(110 + pointerX * 35 - pointerY * 15).toFixed(1)}deg`)
      foil.style.setProperty('--foil-spectrum-shift', `${((pointerX - 0.5) * 32).toFixed(1)}%`)
      foil.style.setProperty('--foil-strength', (0.42 + pointerDistance * 0.58).toFixed(2))
      foil.style.setProperty('--foil-spectrum-opacity', (0.66 + pointerDistance * 0.28).toFixed(2))
      foil.style.setProperty('--foil-glare-opacity', (0.58 + pointerDistance * 0.36).toFixed(2))
      foil.style.setProperty('--foil-sweep-opacity', (0.32 + pointerDistance * 0.52).toFixed(2))
    }
    const move = (event: PointerEvent) => {
      const rect = card.getBoundingClientRect()
      pointerX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
      pointerY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
      if (!frame) frame = requestAnimationFrame(update)
    }
    const reset = () => {
      pointerX = 0.5
      pointerY = 0.4
      if (!frame) frame = requestAnimationFrame(update)
    }
    card.addEventListener('pointermove', move, {passive: true})
    card.addEventListener('pointerleave', reset)
    return () => {
      cancelAnimationFrame(frame)
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerleave', reset)
    }
  }, [active, tier])

  return <div ref={foilRef} aria-hidden='true'
    className={`reffo-card-foil reffo-card-foil--${tier}${active ? ' reffo-card-foil--active' : ''}`}>
    <div className='reffo-card-foil__spectrum' />
    <div className='reffo-card-foil__grain' />
    <div className='reffo-card-foil__glare' />
    <div className='reffo-card-foil__sweep' />
  </div>
}
