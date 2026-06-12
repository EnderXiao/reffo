export const colors = {
  brand: {
    primary: '#1677ff',
    primaryDark: '#135fdb',
    blueRibbon: '#2f6fe3',
    blueRibbonFold: '#234fba',
    warm: '#ff6c43',
    warmDark: '#f27b59',
  },
  text: {
    primary: '#25211f',
    secondary: '#36383d',
    muted: '#beb1aa',
    inverse: '#ffffff',
    warmMuted: '#6f625b',
    coolMuted: '#5f6f8c',
    coolSubtle: '#7b8798',
    neutralMuted: '#969696',
  },
  surface: {
    transparent: 'transparent',
    white: '#ffffff',
    warmBase: '#fff8f3',
    warmPanel: 'rgba(255,251,247,0.76)',
    warmPanelSoft: 'rgba(255,250,246,0.62)',
    warmTab: '#fffdf9',
  },
  border: {
    warmCard: '#ebddd2',
    warmPanel: '#eddccf',
    warmSoft: '#eee0d4',
    warmSoftAlt: '#efdfd4',
    cool: '#aac0df',
    coolActive: '#1677ff',
    neutral: '#dedede',
  },
  icon: {
    muted: '#d1c4bc',
    documentMuted: '#c6b9b2',
  },
  state: {
    error: '#ff4c4c',
    errorText: '#8a6055',
    errorBorder: '#ff8f77',
    errorBackground: '#fff6f2',
  },
} as const

export const space = {
  0: 0,
  1: 4,
  2: 6,
  3: 8,
  4: 10,
  5: 12,
  6: 14,
  7: 16,
  8: 18,
  9: 20,
  10: 24,
  11: 28,
  12: 30,
} as const

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 17,
  xl: 20,
  card: 30,
  full: 999,
} as const

export const typography = {
  fontSize: {
    xs: 10.5,
    sm: 11.5,
    md: 13,
    base: 14,
    lg: 15,
    xl: 16,
    title: 19,
    badge: 28,
  },
  lineHeight: {
    xs: 15,
    sm: 17,
    md: 18,
    base: 20,
    lg: 21,
    xl: 22,
    title: 24,
    body: 24,
    badge: 28,
  },
  weight: {
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const

export const shadow = {
  warmCard: {
    shadowColor: '#d4b4a2',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.15,
    shadowRadius: 22,
    elevation: 4,
  },
  ribbon: {
    shadowColor: '#7b9bd1',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 9,
    elevation: 2,
  },
  softWarm: {
    shadowColor: '#d6c0b6',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
} as const
