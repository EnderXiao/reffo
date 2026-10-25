import {
  buildShareImageFilename,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  wrapShareText,
} from '@/utils/share/share-image-spec'
import type {PublicShareLink} from '@/types/share'

const share: PublicShareLink = {
  share_id: 'share-1',
  schema_version: 1,
  mode: 'job',
  theme: 'green',
  card: {
    kind: 'job',
    display_name: 'Jeremy Smith',
    company: 'Echo/Team',
    position: 'AI Product Manager',
    location: '北京',
    generated_date: '2025.12.15',
    match_score: 88,
    summary_lines: [],
  },
  landing: {
    brand: 'Reffo',
    teaser_title: '一个岗位',
    teaser_subtitle: '一份专门准备的简历',
    teaser_hint: '尝试 Reffo',
    revealed_title: '用 Reffo 量身定制你的新简历',
    revealed_body: '智能弥合简历和岗位之间的差距。',
    cta: '即刻体验',
  },
}

describe('share image spec', () => {
  test('keeps a stable high-resolution canvas ratio', () => {
    expect(SHARE_IMAGE_WIDTH).toBe(1080)
    expect(SHARE_IMAGE_HEIGHT).toBe(2400)
  })

  test('builds filesystem-safe filenames', () => {
    expect(buildShareImageFilename(share, new Date('2026-10-25T10:00:00+08:00')))
      .toBe('Reffo-Echo-Team-AI-Product-Manager-20261025.png')
  })

  test('wraps and clips long text deterministically', () => {
    expect(wrapShareText('一二三四', 2, 2)).toEqual(['一二', '三四'])
    expect(wrapShareText('一二三四五', 2, 2)).toEqual(['一二', '三…'])
    expect(wrapShareText('', 2, 2)).toEqual([])
  })
})
