import type { BoardSize, GridCalibration, Point } from './types'

function grayscaleFromImageData(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData
  const gray = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      gray[y * width + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
  }
  return gray
}

function clampCoord(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function enforceMonotonic(coords: number[], minGap: number, low: number, high: number): number[] {
  const fixed = [...coords]
  fixed[0] = clampCoord(fixed[0], low, high)
  for (let i = 1; i < fixed.length; i += 1) {
    fixed[i] = Math.max(fixed[i], fixed[i - 1] + minGap)
  }
  fixed[fixed.length - 1] = Math.min(fixed[fixed.length - 1], high)
  for (let i = fixed.length - 2; i >= 0; i -= 1) {
    fixed[i] = Math.min(fixed[i], fixed[i + 1] - minGap)
  }
  for (let i = 0; i < fixed.length; i += 1) {
    fixed[i] = clampCoord(fixed[i], low, high)
  }
  return fixed
}

function verticalLineScore(
  x: number,
  width: number,
  height: number,
  gray: Float32Array,
): number {
  const xInt = Math.round(clampCoord(x, 1, width - 2))
  const y0 = Math.floor(height * 0.05)
  const y1 = Math.ceil(height * 0.95)
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    const base = y * width
    const left = gray[base + xInt - 1]
    const center = gray[base + xInt]
    const right = gray[base + xInt + 1]
    const gradient = Math.abs(left - right)
    const darkness = 255 - center
    sum += gradient + darkness * 0.8
    count += 1
  }
  return count > 0 ? sum / count : -Infinity
}

function horizontalLineScore(
  y: number,
  width: number,
  height: number,
  gray: Float32Array,
): number {
  const yInt = Math.round(clampCoord(y, 1, height - 2))
  const x0 = Math.floor(width * 0.05)
  const x1 = Math.ceil(width * 0.95)
  let sum = 0
  let count = 0
  for (let x = x0; x < x1; x += 1) {
    const top = gray[(yInt - 1) * width + x]
    const center = gray[yInt * width + x]
    const bottom = gray[(yInt + 1) * width + x]
    const gradient = Math.abs(top - bottom)
    const darkness = 255 - center
    sum += gradient + darkness * 0.8
    count += 1
  }
  return count > 0 ? sum / count : -Infinity
}

export function calibrateGridLines(
  warped: ImageData,
  boardSize: BoardSize,
  maxShiftPx: number,
): GridCalibration {
  if (boardSize < 2) {
    throw new Error('boardSize must be at least 2')
  }

  const { width, height } = warped
  const gray = grayscaleFromImageData(warped)
  const step = (width - 1) / (boardSize - 1)
  const expected = Array.from({ length: boardSize }, (_, i) => i * step)

  const xCoords = expected.map((base) => {
    let bestCoord = base
    let bestScore = -Infinity
    for (let shift = -maxShiftPx; shift <= maxShiftPx; shift += 1) {
      const candidate = base + shift
      const score = verticalLineScore(candidate, width, height, gray)
      if (score > bestScore) {
        bestScore = score
        bestCoord = candidate
      }
    }
    return bestCoord
  })

  const yCoords = expected.map((base) => {
    let bestCoord = base
    let bestScore = -Infinity
    for (let shift = -maxShiftPx; shift <= maxShiftPx; shift += 1) {
      const candidate = base + shift
      const score = horizontalLineScore(candidate, width, height, gray)
      if (score > bestScore) {
        bestScore = score
        bestCoord = candidate
      }
    }
    return bestCoord
  })

  const minGap = step * 0.45
  return {
    xCoords: enforceMonotonic(xCoords, minGap, 0, width - 1),
    yCoords: enforceMonotonic(yCoords, minGap, 0, height - 1),
  }
}

export function buildIntersectionsFromCalibratedGrid(calibration: GridCalibration): Point[] {
  const { xCoords, yCoords } = calibration
  if (xCoords.length === 0 || yCoords.length === 0 || xCoords.length !== yCoords.length) {
    throw new Error('Invalid grid calibration: coordinate lengths must be non-empty and equal')
  }

  const points: Point[] = []
  for (let row = 0; row < yCoords.length; row += 1) {
    for (let col = 0; col < xCoords.length; col += 1) {
      points.push({
        x: xCoords[col],
        y: yCoords[row],
      })
    }
  }
  return points
}
