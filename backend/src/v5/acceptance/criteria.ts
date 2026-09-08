// Freeze before generating candidates; changing this version requires a new comparison cohort.
export const V5_ACCEPTANCE_CRITERIA = Object.freeze({
  version: 'v5-recruiter-acceptance-v1',
  minimumRealCases: 100,
  minimumAdversarialCases: 30,
  maximumMajorIncidents: 0,
  minimumFirstPassRate: 0.95,
  minimumBoundedSuccessRate: 0.98,
  minimumHumanDeliverableRate: 0.9,
  minimumHumanMedianScore: 80,
  minimumPairwiseWinRate: 0.6,
  maximumPairwiseLossRate: 0.1,
  maximumTokenMedianRatio: 1,
  maximumTokenP95Ratio: 1,
  maximumLatencyP95Ratio: 1,
  scoreDimensionMaxima: [25, 20, 15, 10, 10, 10, 10] as const,
})
