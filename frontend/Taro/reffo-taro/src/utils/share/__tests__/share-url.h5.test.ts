import {buildShareLandingUrl} from '../share-url.h5'

describe('buildShareLandingUrl', () => {
  test('uses the current web origin for the public landing route', () => {
    expect(buildShareLandingUrl(
      'public-token',
      'http://localhost:10086/#/pages/share/index?historyId=history-1',
    )).toBe(
      'http://localhost:10086/#/pages/share-landing/index?shareToken=public-token',
    )
  })

  test('keeps the deployment path and encodes the share token', () => {
    expect(buildShareLandingUrl(
      'header/payload+signature',
      'https://app.example.com/reffo/?source=share#/pages/share/index',
    )).toBe(
      'https://app.example.com/reffo/#/pages/share-landing/index?shareToken=header%2Fpayload%2Bsignature',
    )
  })
})
