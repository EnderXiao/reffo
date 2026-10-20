import {render} from '@testing-library/react'
import UnreadCardFoil from '../UnreadCardFoil.h5'

describe('UnreadCardFoil H5', () => {
  test('指针位置同步驱动光带位置、角度和强度', () => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const {container} = render(
      <div data-home-card-id='card-1'>
        <UnreadCardFoil active tier='enhanced' />
      </div>,
    )
    const card = container.querySelector<HTMLElement>('[data-home-card-id]')!
    const foil = container.querySelector<HTMLElement>('.reffo-card-foil')!
    card.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    card.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 150,
      clientY: 75,
    }))

    expect(foil.style.getPropertyValue('--foil-x')).toBe('75.0%')
    expect(foil.style.getPropertyValue('--foil-y')).toBe('37.5%')
    expect(foil.style.getPropertyValue('--foil-angle')).toBe('130.6deg')
    expect(foil.style.getPropertyValue('--foil-spectrum-shift')).toBe('8.0%')
    expect(Number(foil.style.getPropertyValue('--foil-glare-opacity'))).toBeGreaterThan(0.58)
    expect(Number(foil.style.getPropertyValue('--foil-sweep-opacity'))).toBeGreaterThan(0.32)
  })
})
