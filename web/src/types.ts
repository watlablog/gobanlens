export type BoardSize = 9 | 13 | 19
export type Stone = 'E' | 'B' | 'W'
export type Player = 'B' | 'W'

export type AppSettings = {
  boardSize: BoardSize
  toPlay: Player
  komi: number
}

export type Point = {
  x: number
  y: number
}

export type CornerPoints = [Point, Point, Point, Point]

export type BoardState = Stone[]

export type GridCalibration = {
  xCoords: number[]
  yCoords: number[]
}

export type StoneEstimatorOptions = {
  patchRadiusRatio: number
  ringInnerScale: number
  ringOuterScale: number
  localScale: number
  adaptiveBlockSize: number
  adaptiveOffset: number
  normalizedGain: number
  streamSelectZWeight: number
  streamSelectStdWeight: number

  stage1EmptyStdMax: number
  stage1EmptyContrastAbsMax: number
  stage1EmptyAbsZMax: number
  stage1BlackZMax: number
  stage1BlackContrastMin: number
  stage1BlackDarkRatioMin: number
  stage1BlackChromaMax: number
  stage1WhiteZMin: number
  stage1WhiteContrastMin: number
  stage1WhiteBrightRatioMin: number
  stage1WhiteDarkRatioMax: number
  stage1WhiteChromaMax: number

  stage2MadScale: number
  stage2MinSeedCount: number
  stage2MinMargin: number
  stage2UnknownToEmptyBias: number
  stage2ZWeight: number
  stage2ContrastWeight: number
  stage2RatioWeight: number
  stage2ChromaWeight: number
  stage2EmptyStdPenalty: number
  stage2EmptyContrastPenalty: number
  stage2EmptyZPenalty: number
  stage2FallbackBlackZMax: number
  stage2FallbackBlackContrastMin: number
  stage2FallbackBlackDarkRatioMin: number
  stage2FallbackWhiteZMin: number
  stage2FallbackWhiteContrastMin: number
  stage2FallbackWhiteBrightRatioMin: number
  stage2FallbackWhiteDarkRatioMax: number
  stage2FallbackWhiteChromaMax: number

  postConfidenceLock: number
  postIsolatedOppositeMin: number
  postDominantOppositeMin: number
  postMaxSameForFlip: number
}

export type ViewName = 'home' | 'crop' | 'verify' | 'export'

export type WarpResult = {
  imageData: ImageData
  dataUrl: string
}
