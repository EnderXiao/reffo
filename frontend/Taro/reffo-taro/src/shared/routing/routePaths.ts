export const routePaths = {
  landing: '/pages/landing/index',
  home: '/pages/index/index',
  create: '/pages/create/index',
  landingAnalysis: '/pages/landing-analysis/index',
  landingResult: '/pages/landing-result/index',
  result: '/pages/result/index',
  complete: '/pages/complete/index',
  auth: '/pages/auth/index',
  profile: '/pages/profile/index',
} as const

export type RoutePath = (typeof routePaths)[keyof typeof routePaths]
