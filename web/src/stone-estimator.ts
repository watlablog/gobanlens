import { DEFAULT_STONE_ESTIMATOR_OPTIONS } from './stone-config'
import type { BoardSize, BoardState, Point, StoneEstimatorOptions } from './types'

const UNKNOWN_ID = -1
const EMPTY_ID = 0
const BLACK_ID = 1
const WHITE_ID = 2

export type StreamKind = 'raw' | 'normalized'

export type PointFeature = {
  centerLuma: number
  contrastMiddle: number
  contrastOuter: number
  localStd: number
  z: number
  saturationMean: number
  chromaMean: number
  darkRatio: number
  brightRatio: number
  stream: StreamKind
}

export type PointScores = {
  black: number
  white: number
  empty: number
  confidence: number
}

type StreamImage = {
  luma: Float32Array
  darkBinary: Uint8Array
  brightBinary: Uint8Array
}

type PreparedImage = {
  width: number
  height: number
  chroma: Float32Array
  saturation: Float32Array
  raw: StreamImage
  normalized: StreamImage
}

type RobustStat = {
  median: number
  mad: number
}

type SeedStats = {
  count: number
  z: RobustStat
  contrastOuter: RobustStat
  darkRatio: RobustStat
  brightRatio: RobustStat
  chroma: RobustStat
  localStd: RobustStat
  absContrast: RobustStat
  absZ: RobustStat
}

type Stage1Result = 'B' | 'W' | 'E' | 'U'

function rgbToLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function rgbToSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === 0) {
    return 0
  }
  return ((max - min) / max) * 255
}

function rgbToChroma(r: number, g: number, b: number): number {
  return (Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b)) / 3
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, value))
}

function buildIntegralImage(values: Float32Array, width: number, height: number): Float64Array {
  const stride = width + 1
  const integral = new Float64Array((height + 1) * stride)

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0
    for (let x = 1; x <= width; x += 1) {
      rowSum += values[(y - 1) * width + (x - 1)]
      integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum
    }
  }

  return integral
}

function rectSum(
  integral: Float64Array,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ax = x0
  const ay = y0
  const bx = x1 + 1
  const by = y1 + 1
  return (
    integral[by * stride + bx] -
    integral[ay * stride + bx] -
    integral[by * stride + ax] +
    integral[ay * stride + ax]
  )
}

function buildLocalMeanMap(
  luma: Float32Array,
  width: number,
  height: number,
  blockSize: number,
): Float32Array {
  const stride = width + 1
  const integral = buildIntegralImage(luma, width, height)
  const radius = Math.max(1, Math.floor(blockSize / 2))
  const meanMap = new Float32Array(width * height)

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      meanMap[y * width + x] = rectSum(integral, stride, x0, y0, x1, y1) / area
    }
  }

  return meanMap
}

function buildAdaptiveBinaryMaps(
  luma: Float32Array,
  meanMap: Float32Array,
  offset: number,
): { darkBinary: Uint8Array; brightBinary: Uint8Array } {
  const darkBinary = new Uint8Array(luma.length)
  const brightBinary = new Uint8Array(luma.length)

  for (let i = 0; i < luma.length; i += 1) {
    const value = luma[i]
    const mean = meanMap[i]
    darkBinary[i] = value < mean - offset ? 1 : 0
    brightBinary[i] = value > mean + offset ? 1 : 0
  }

  return { darkBinary, brightBinary }
}

function preprocessImageData(imageData: ImageData, options: StoneEstimatorOptions): PreparedImage {
  const { data, width, height } = imageData
  const pixelCount = width * height
  const rawLuma = new Float32Array(pixelCount)
  const chroma = new Float32Array(pixelCount)
  const saturation = new Float32Array(pixelCount)

  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    rawLuma[i] = rgbToLuma(r, g, b)
    chroma[i] = rgbToChroma(r, g, b)
    saturation[i] = rgbToSaturation(r, g, b)
  }

  const blockSize = Math.max(3, Math.floor(options.adaptiveBlockSize) | 1)
  const rawMean = buildLocalMeanMap(rawLuma, width, height, blockSize)

  const normalizedLuma = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i += 1) {
    normalizedLuma[i] = clamp255(128 + (rawLuma[i] - rawMean[i]) * options.normalizedGain)
  }

  const normalizedMean = buildLocalMeanMap(normalizedLuma, width, height, blockSize)

  const rawBinary = buildAdaptiveBinaryMaps(rawLuma, rawMean, options.adaptiveOffset)
  const normalizedBinary = buildAdaptiveBinaryMaps(
    normalizedLuma,
    normalizedMean,
    options.adaptiveOffset,
  )

  return {
    width,
    height,
    chroma,
    saturation,
    raw: {
      luma: rawLuma,
      darkBinary: rawBinary.darkBinary,
      brightBinary: rawBinary.brightBinary,
    },
    normalized: {
      luma: normalizedLuma,
      darkBinary: normalizedBinary.darkBinary,
      brightBinary: normalizedBinary.brightBinary,
    },
  }
}

function sampleFeature(
  imageData: ImageData,
  prepared: PreparedImage,
  stream: StreamKind,
  center: Point,
  radius: number,
  options: StoneEstimatorOptions,
): PointFeature {
  const { width, height } = imageData
  const streamImage = stream === 'raw' ? prepared.raw : prepared.normalized
  const cx = Math.round(center.x)
  const cy = Math.round(center.y)

  const centerRadius = Math.max(2, radius)
  const ringInner = Math.max(centerRadius + 1, Math.round(centerRadius * options.ringInnerScale))
  const ringOuter = Math.max(ringInner + 1, Math.round(centerRadius * options.ringOuterScale))
  const outerInner = Math.max(ringOuter + 1, Math.round(centerRadius * (options.ringOuterScale + 0.4)))
  const outerOuter = Math.max(outerInner + 1, Math.round(centerRadius * (options.ringOuterScale + 1.0)))
  const localRadius = Math.max(outerOuter + 1, Math.round(centerRadius * options.localScale))

  const minX = Math.max(0, cx - localRadius)
  const maxX = Math.min(width - 1, cx + localRadius)
  const minY = Math.max(0, cy - localRadius)
  const maxY = Math.min(height - 1, cy + localRadius)

  let centerLumaSum = 0
  let centerSatSum = 0
  let centerChromaSum = 0
  let centerDarkCount = 0
  let centerBrightCount = 0
  let centerCount = 0

  let middleLumaSum = 0
  let middleCount = 0

  let outerLumaSum = 0
  let outerCount = 0

  let localLumaSum = 0
  let localLumaSquareSum = 0
  let localCount = 0

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx
      const dy = y - cy
      const d2 = dx * dx + dy * dy

      if (d2 > localRadius * localRadius) {
        continue
      }

      const index = y * width + x
      const luma = streamImage.luma[index]

      localLumaSum += luma
      localLumaSquareSum += luma * luma
      localCount += 1

      if (d2 <= centerRadius * centerRadius) {
        centerLumaSum += luma
        centerSatSum += prepared.saturation[index]
        centerChromaSum += prepared.chroma[index]
        centerDarkCount += streamImage.darkBinary[index]
        centerBrightCount += streamImage.brightBinary[index]
        centerCount += 1
      } else if (d2 >= ringInner * ringInner && d2 <= ringOuter * ringOuter) {
        middleLumaSum += luma
        middleCount += 1
      } else if (d2 >= outerInner * outerInner && d2 <= outerOuter * outerOuter) {
        outerLumaSum += luma
        outerCount += 1
      }
    }
  }

  const centerLuma = centerCount > 0 ? centerLumaSum / centerCount : 0
  const middleRingLuma = middleCount > 0 ? middleLumaSum / middleCount : centerLuma
  const outerRingLuma = outerCount > 0 ? outerLumaSum / outerCount : middleRingLuma

  const localMean = localCount > 0 ? localLumaSum / localCount : centerLuma
  const variance = localCount > 0 ? localLumaSquareSum / localCount - localMean * localMean : 1
  const localStd = Math.sqrt(Math.max(1e-6, variance))

  return {
    centerLuma,
    contrastMiddle: centerLuma - middleRingLuma,
    contrastOuter: centerLuma - outerRingLuma,
    localStd,
    z: (centerLuma - localMean) / (localStd + 1e-6),
    saturationMean: centerCount > 0 ? centerSatSum / centerCount : 0,
    chromaMean: centerCount > 0 ? centerChromaSum / centerCount : 0,
    darkRatio: centerCount > 0 ? centerDarkCount / centerCount : 0,
    brightRatio: centerCount > 0 ? centerBrightCount / centerCount : 0,
    stream,
  }
}

function separationScore(feature: PointFeature, options: StoneEstimatorOptions): number {
  return (
    Math.abs(feature.contrastOuter) +
    Math.abs(feature.z) * options.streamSelectZWeight +
    feature.localStd * options.streamSelectStdWeight
  )
}

function selectFeatureByStream(
  rawFeature: PointFeature,
  normalizedFeature: PointFeature,
  options: StoneEstimatorOptions,
): PointFeature {
  return separationScore(normalizedFeature, options) > separationScore(rawFeature, options)
    ? normalizedFeature
    : rawFeature
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid]
  }
  return (sorted[mid - 1] + sorted[mid]) / 2
}

function buildRobustStat(values: number[]): RobustStat {
  const med = median(values)
  const deviations = values.map((value) => Math.abs(value - med))
  const mad = Math.max(1e-3, median(deviations))
  return { median: med, mad }
}

function buildSeedStats(features: PointFeature[]): SeedStats | null {
  if (features.length === 0) {
    return null
  }

  const z = features.map((feature) => feature.z)
  const contrastOuter = features.map((feature) => feature.contrastOuter)
  const darkRatio = features.map((feature) => feature.darkRatio)
  const brightRatio = features.map((feature) => feature.brightRatio)
  const chroma = features.map((feature) => feature.chromaMean)
  const localStd = features.map((feature) => feature.localStd)

  return {
    count: features.length,
    z: buildRobustStat(z),
    contrastOuter: buildRobustStat(contrastOuter),
    darkRatio: buildRobustStat(darkRatio),
    brightRatio: buildRobustStat(brightRatio),
    chroma: buildRobustStat(chroma),
    localStd: buildRobustStat(localStd),
    absContrast: buildRobustStat(contrastOuter.map((value) => Math.abs(value))),
    absZ: buildRobustStat(z.map((value) => Math.abs(value))),
  }
}

function classifyStage1Seed(feature: PointFeature, options: StoneEstimatorOptions): Stage1Result {
  const isSeedEmpty =
    feature.localStd <= options.stage1EmptyStdMax &&
    Math.abs(feature.contrastOuter) <= options.stage1EmptyContrastAbsMax &&
    Math.abs(feature.z) <= options.stage1EmptyAbsZMax
  if (isSeedEmpty) {
    return 'E'
  }

  const isSeedBlack =
    feature.z <= options.stage1BlackZMax &&
    feature.contrastOuter <= -options.stage1BlackContrastMin &&
    feature.darkRatio >= options.stage1BlackDarkRatioMin &&
    feature.chromaMean <= options.stage1BlackChromaMax
  if (isSeedBlack) {
    return 'B'
  }

  const isSeedWhite =
    feature.z >= options.stage1WhiteZMin &&
    feature.contrastOuter >= options.stage1WhiteContrastMin &&
    feature.brightRatio >= options.stage1WhiteBrightRatioMin &&
    feature.darkRatio <= options.stage1WhiteDarkRatioMax &&
    feature.chromaMean <= options.stage1WhiteChromaMax
  if (isSeedWhite) {
    return 'W'
  }

  return 'U'
}

function robustDistance(value: number, stat: RobustStat, scale: number): number {
  return Math.abs(value - stat.median) / (stat.mad * scale + 1e-3)
}

function scoreBlack(
  feature: PointFeature,
  stats: SeedStats | null,
  options: StoneEstimatorOptions,
): number {
  if (stats && stats.count >= options.stage2MinSeedCount) {
    return -(
      robustDistance(feature.z, stats.z, options.stage2MadScale) * options.stage2ZWeight +
      robustDistance(feature.contrastOuter, stats.contrastOuter, options.stage2MadScale) *
        options.stage2ContrastWeight +
      robustDistance(feature.darkRatio, stats.darkRatio, options.stage2MadScale) * options.stage2RatioWeight +
      robustDistance(feature.brightRatio, stats.brightRatio, options.stage2MadScale) * options.stage2RatioWeight * 0.6 +
      robustDistance(feature.chromaMean, stats.chroma, options.stage2MadScale) * options.stage2ChromaWeight
    )
  }

  let score = 0
  score -= Math.max(0, feature.z - options.stage2FallbackBlackZMax) * options.stage2ZWeight * 2
  score -=
    Math.max(0, feature.contrastOuter + options.stage2FallbackBlackContrastMin) *
    options.stage2ContrastWeight *
    0.08
  score -=
    Math.max(0, options.stage2FallbackBlackDarkRatioMin - feature.darkRatio) *
    options.stage2RatioWeight *
    2
  score -= feature.brightRatio * options.stage2RatioWeight * 0.4
  score -= feature.chromaMean * options.stage2ChromaWeight * 0.03
  return score
}

function scoreWhite(
  feature: PointFeature,
  stats: SeedStats | null,
  options: StoneEstimatorOptions,
): number {
  if (feature.chromaMean > options.stage2FallbackWhiteChromaMax * 1.1) {
    return -1000
  }

  const chromaOverflow = Math.max(0, feature.chromaMean - options.stage2FallbackWhiteChromaMax)

  if (stats && stats.count >= options.stage2MinSeedCount) {
    return (
      -(
      robustDistance(feature.z, stats.z, options.stage2MadScale) * options.stage2ZWeight +
      robustDistance(feature.contrastOuter, stats.contrastOuter, options.stage2MadScale) *
        options.stage2ContrastWeight +
      robustDistance(feature.brightRatio, stats.brightRatio, options.stage2MadScale) * options.stage2RatioWeight +
      robustDistance(feature.darkRatio, stats.darkRatio, options.stage2MadScale) * options.stage2RatioWeight * 0.6 +
      robustDistance(feature.chromaMean, stats.chroma, options.stage2MadScale) * options.stage2ChromaWeight
    ) - chromaOverflow * options.stage2ChromaWeight * 0.25
    )
  }

  let score = 0
  score -= Math.max(0, options.stage2FallbackWhiteZMin - feature.z) * options.stage2ZWeight * 2
  score -=
    Math.max(0, options.stage2FallbackWhiteContrastMin - feature.contrastOuter) *
    options.stage2ContrastWeight *
    0.08
  score -=
    Math.max(0, options.stage2FallbackWhiteBrightRatioMin - feature.brightRatio) *
    options.stage2RatioWeight *
    2
  score -=
    Math.max(0, feature.darkRatio - options.stage2FallbackWhiteDarkRatioMax) *
    options.stage2RatioWeight *
    1.5
  score -=
    Math.max(0, feature.chromaMean - options.stage2FallbackWhiteChromaMax) *
    options.stage2ChromaWeight *
    0.25
  return score
}

function scoreEmpty(
  feature: PointFeature,
  stats: SeedStats | null,
  options: StoneEstimatorOptions,
): number {
  let score = -(
    Math.max(0, feature.localStd - options.stage1EmptyStdMax) * options.stage2EmptyStdPenalty +
    Math.max(0, Math.abs(feature.contrastOuter) - options.stage1EmptyContrastAbsMax) *
      options.stage2EmptyContrastPenalty +
    Math.max(0, Math.abs(feature.z) - options.stage1EmptyAbsZMax) * options.stage2EmptyZPenalty
  )

  if (stats && stats.count >= options.stage2MinSeedCount) {
    score -=
      robustDistance(Math.abs(feature.contrastOuter), stats.absContrast, options.stage2MadScale) *
      options.stage2ContrastWeight *
      0.8
    score -=
      robustDistance(Math.abs(feature.z), stats.absZ, options.stage2MadScale) * options.stage2ZWeight * 0.6
    score -=
      robustDistance(feature.localStd, stats.localStd, options.stage2MadScale) *
      options.stage2RatioWeight *
      0.4
  }

  return score
}

function classifyUnknownPoint(
  feature: PointFeature,
  blackStats: SeedStats | null,
  whiteStats: SeedStats | null,
  emptyStats: SeedStats | null,
  options: StoneEstimatorOptions,
): { stoneId: number; confidence: number } {
  const scores = {
    black: scoreBlack(feature, blackStats, options),
    white: scoreWhite(feature, whiteStats, options),
    empty: scoreEmpty(feature, emptyStats, options),
  }

  const obviousWoodHighlight =
    feature.chromaMean > options.stage2FallbackWhiteChromaMax * 1.3 &&
    feature.brightRatio > 0.6 &&
    feature.darkRatio < 0.45
  if (obviousWoodHighlight) {
    return {
      stoneId: EMPTY_ID,
      confidence: 0,
    }
  }

  const sorted: Array<{ stoneId: number; score: number }> = [
    { stoneId: BLACK_ID, score: scores.black },
    { stoneId: WHITE_ID, score: scores.white },
    { stoneId: EMPTY_ID, score: scores.empty },
  ].sort((a, b) => b.score - a.score)

  const best = sorted[0]
  const second = sorted[1]
  const margin = Math.max(0, best.score - second.score)
  const looksLikeWoodHighlight =
    feature.saturationMean > 70 &&
    feature.chromaMean > options.stage2FallbackWhiteChromaMax * 1.3

  if (
    best.stoneId === WHITE_ID &&
    looksLikeWoodHighlight &&
    scores.empty >= best.score - options.stage2UnknownToEmptyBias
  ) {
    return {
      stoneId: EMPTY_ID,
      confidence: margin,
    }
  }

  const recoverStone = (): number => {
    const blackRecover =
      feature.darkRatio >= 0.45 &&
      feature.z <= -0.22 &&
      feature.contrastMiddle <= -8 &&
      feature.chromaMean <= 10
    if (blackRecover) {
      return BLACK_ID
    }

    const whiteRecover1 =
      feature.contrastOuter >= 18 &&
      feature.brightRatio >= 0.72 &&
      feature.darkRatio <= 0.3 &&
      feature.chromaMean <= 9
    if (whiteRecover1) {
      return WHITE_ID
    }

    const whiteRecover2 =
      feature.brightRatio >= 0.8 &&
      feature.darkRatio <= 0.22 &&
      feature.contrastMiddle >= 10 &&
      feature.z >= 0.05 &&
      feature.chromaMean <= 8
    if (whiteRecover2) {
      return WHITE_ID
    }

    const whiteRecover3 =
      feature.z >= 0.12 &&
      feature.contrastOuter >= 12 &&
      feature.brightRatio >= 0.7 &&
      feature.darkRatio <= 0.3 &&
      feature.chromaMean <= 8
    if (whiteRecover3) {
      return WHITE_ID
    }

    return EMPTY_ID
  }

  if (best.stoneId === EMPTY_ID) {
    return {
      stoneId: recoverStone(),
      confidence: margin,
    }
  }

  if (
    best.stoneId !== EMPTY_ID &&
    (margin < options.stage2MinMargin || scores.empty >= best.score - options.stage2UnknownToEmptyBias)
  ) {
    const recovered = recoverStone()
    if (recovered !== EMPTY_ID) {
      return {
        stoneId: recovered,
        confidence: margin,
      }
    }

    return {
      stoneId: EMPTY_ID,
      confidence: margin,
    }
  }

  return {
    stoneId: best.stoneId,
    confidence: margin,
  }
}

function applyLocalConsistencyFilter(
  board: Int8Array,
  confidence: Float32Array,
  boardSize: BoardSize,
  options: StoneEstimatorOptions,
): Int8Array {
  const out = new Int8Array(board)

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const index = row * boardSize + col
      const stoneId = board[index]

      if (stoneId !== BLACK_ID && stoneId !== WHITE_ID) {
        continue
      }
      if (confidence[index] >= options.postConfidenceLock) {
        continue
      }

      let same = 0
      let opposite = 0

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue
          }
          const nr = row + dy
          const nc = col + dx
          if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) {
            continue
          }

          const neighborStone = board[nr * boardSize + nc]
          if (neighborStone === stoneId) {
            same += 1
          } else if (neighborStone !== EMPTY_ID) {
            opposite += 1
          }
        }
      }

      if (same === 0 && opposite >= options.postIsolatedOppositeMin) {
        out[index] = EMPTY_ID
        continue
      }

      if (opposite >= options.postDominantOppositeMin && same <= options.postMaxSameForFlip) {
        out[index] = stoneId === BLACK_ID ? WHITE_ID : BLACK_ID
      }
    }
  }

  return out
}

function toStone(id: number): BoardState[number] {
  if (id === BLACK_ID) {
    return 'B'
  }
  if (id === WHITE_ID) {
    return 'W'
  }
  return 'E'
}

export function estimateBoardStones(
  warped: ImageData,
  points: Point[],
  boardSize: BoardSize,
  options: StoneEstimatorOptions = DEFAULT_STONE_ESTIMATOR_OPTIONS,
): BoardState {
  if (points.length !== boardSize * boardSize) {
    throw new Error('Intersection count does not match board size')
  }

  const prepared = preprocessImageData(warped, options)
  const patchRadius = Math.max(4, Math.round(warped.width / (boardSize * options.patchRadiusRatio)))

  const features: PointFeature[] = points.map((point) => {
    const rawFeature = sampleFeature(warped, prepared, 'raw', point, patchRadius, options)
    const normalizedFeature = sampleFeature(warped, prepared, 'normalized', point, patchRadius, options)
    return selectFeatureByStream(rawFeature, normalizedFeature, options)
  })

  const board = new Int8Array(points.length)
  board.fill(UNKNOWN_ID)
  const confidence = new Float32Array(points.length)

  const blackSeedFeatures: PointFeature[] = []
  const whiteSeedFeatures: PointFeature[] = []
  const emptySeedFeatures: PointFeature[] = []

  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i]
    const seed = classifyStage1Seed(feature, options)

    if (seed === 'B') {
      board[i] = BLACK_ID
      confidence[i] = 1.5
      blackSeedFeatures.push(feature)
    } else if (seed === 'W') {
      board[i] = WHITE_ID
      confidence[i] = 1.5
      whiteSeedFeatures.push(feature)
    } else if (seed === 'E') {
      board[i] = EMPTY_ID
      confidence[i] = 1.5
      emptySeedFeatures.push(feature)
    }
  }

  const blackStats = buildSeedStats(blackSeedFeatures)
  const whiteStats = buildSeedStats(whiteSeedFeatures)
  const emptyStats = buildSeedStats(emptySeedFeatures)

  for (let i = 0; i < features.length; i += 1) {
    if (board[i] !== UNKNOWN_ID) {
      continue
    }

    const classified = classifyUnknownPoint(features[i], blackStats, whiteStats, emptyStats, options)
    board[i] = classified.stoneId
    confidence[i] = classified.confidence
  }

  const postProcessed = applyLocalConsistencyFilter(board, confidence, boardSize, options)
  return Array.from(postProcessed, toStone)
}
