import { describe, expect, test } from 'vitest'

import { buildIntersectionsFromCalibratedGrid, calibrateGridLines } from './grid-calibration'

function createGridImageData(
  width: number,
  height: number,
  xCoords: number[],
  yCoords: number[],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4
    data[offset] = 214
    data[offset + 1] = 195
    data[offset + 2] = 160
    data[offset + 3] = 255
  }

  const paintPixel = (x: number, y: number, value: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return
    }
    const offset = (y * width + x) * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  }

  for (const xRaw of xCoords) {
    const x = Math.round(xRaw)
    for (let y = 0; y < height; y += 1) {
      paintPixel(x, y, 52)
      paintPixel(x - 1, y, 78)
      paintPixel(x + 1, y, 78)
    }
  }

  for (const yRaw of yCoords) {
    const y = Math.round(yRaw)
    for (let x = 0; x < width; x += 1) {
      paintPixel(x, y, 52)
      paintPixel(x, y - 1, 78)
      paintPixel(x, y + 1, 78)
    }
  }

  return {
    data,
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData
}

function meanAbsError(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i += 1) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum / n
}

describe('grid calibration', () => {
  test('calibrateGridLines reduces line position error compared to uniform grid', () => {
    const boardSize = 9
    const width = 201
    const height = 201

    const baseStep = (width - 1) / (boardSize - 1)

    const trueX = Array.from({ length: boardSize }, (_, i) => i * baseStep + ((i % 3) - 1) * 2)
    const trueY = Array.from({ length: boardSize }, (_, i) => i * baseStep + (((i + 1) % 3) - 1) * 2)

    const imageData = createGridImageData(width, height, trueX, trueY)
    const calibrated = calibrateGridLines(imageData, boardSize as 9, 4)

    const baselineX = Array.from({ length: boardSize }, (_, i) => i * baseStep)
    const baselineY = Array.from({ length: boardSize }, (_, i) => i * baseStep)

    const baselineError =
      meanAbsError(baselineX, trueX) + meanAbsError(baselineY, trueY)
    const calibratedError =
      meanAbsError(calibrated.xCoords, trueX) + meanAbsError(calibrated.yCoords, trueY)

    expect(calibratedError).toBeLessThan(baselineError)
  })

  test('buildIntersectionsFromCalibratedGrid creates row-major points', () => {
    const points = buildIntersectionsFromCalibratedGrid({
      xCoords: [0, 10, 20],
      yCoords: [1, 11, 21],
    })

    expect(points).toHaveLength(9)
    expect(points[0]).toEqual({ x: 0, y: 1 })
    expect(points[1]).toEqual({ x: 10, y: 1 })
    expect(points[3]).toEqual({ x: 0, y: 11 })
    expect(points[8]).toEqual({ x: 20, y: 21 })
  })
})
