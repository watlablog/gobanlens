import { describe, expect, test } from 'vitest'

import { DEFAULT_STONE_ESTIMATOR_OPTIONS } from './stone-config'
import { estimateBoardStones } from './stone-estimator'
import type { Point, StoneEstimatorOptions } from './types'

function createSyntheticImageData(width: number, height: number, base: number): ImageData {
  return createFlatImageData(width, height, [base, base, base])
}

function createFlatImageData(
  width: number,
  height: number,
  rgb: [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4
    data[offset] = rgb[0]
    data[offset + 1] = rgb[1]
    data[offset + 2] = rgb[2]
    data[offset + 3] = 255
  }
  return {
    data,
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData
}

function drawDisc(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
  rgb: [number, number, number],
): void {
  const { data, width, height } = imageData
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX
      const dy = y - centerY
      if (dx * dx + dy * dy > radius * radius) {
        continue
      }
      const offset = (y * width + x) * 4
      data[offset] = rgb[0]
      data[offset + 1] = rgb[1]
      data[offset + 2] = rgb[2]
      data[offset + 3] = 255
    }
  }
}

function intersections(boardSize: number, outSize: number): Point[] {
  const points: Point[] = []
  const step = (outSize - 1) / (boardSize - 1)
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      points.push({ x: col * step, y: row * step })
    }
  }
  return points
}

function withOptions(overrides: Partial<StoneEstimatorOptions>): StoneEstimatorOptions {
  return {
    ...DEFAULT_STONE_ESTIMATOR_OPTIONS,
    ...overrides,
  }
}

describe('estimateBoardStones', () => {
  test('stage1 detects strong black/white/empty points', () => {
    const boardSize = 9
    const outSize = 120
    const imageData = createSyntheticImageData(outSize, outSize, 140)
    const points = intersections(boardSize, outSize)

    const blackIndex = 4 * boardSize + 4
    const whiteIndex = 2 * boardSize + 6

    drawDisc(
      imageData,
      Math.round(points[blackIndex].x),
      Math.round(points[blackIndex].y),
      6,
      [22, 22, 22],
    )
    drawDisc(
      imageData,
      Math.round(points[whiteIndex].x),
      Math.round(points[whiteIndex].y),
      6,
      [244, 244, 244],
    )

    const board = estimateBoardStones(imageData, points, 9)

    expect(board[blackIndex]).toBe('B')
    expect(board[whiteIndex]).toBe('W')
    expect(board[0]).toBe('E')
  })

  test('stage2 recovers weak white near white seeds', () => {
    const boardSize = 9
    const outSize = 150
    const imageData = createSyntheticImageData(outSize, outSize, 155)
    const points = intersections(boardSize, outSize)

    const strongWhiteA = 1 * boardSize + 1
    const strongWhiteB = 1 * boardSize + 2
    const weakWhite = 1 * boardSize + 3
    const blackSeed = 6 * boardSize + 6

    for (const index of [strongWhiteA, strongWhiteB]) {
      drawDisc(
        imageData,
        Math.round(points[index].x),
        Math.round(points[index].y),
        7,
        [242, 242, 242],
      )
    }

    drawDisc(
      imageData,
      Math.round(points[weakWhite].x),
      Math.round(points[weakWhite].y),
      7,
      [186, 186, 186],
    )

    drawDisc(
      imageData,
      Math.round(points[blackSeed].x),
      Math.round(points[blackSeed].y),
      7,
      [28, 28, 28],
    )

    const board = estimateBoardStones(imageData, points, 9)

    expect(board[strongWhiteA]).toBe('W')
    expect(board[strongWhiteB]).toBe('W')
    expect(board[weakWhite]).toBe('W')
    expect(board[blackSeed]).toBe('B')
  })

  test('rejects bright high-saturation wood highlights as white stones', () => {
    const boardSize = 9
    const outSize = 90
    const imageData = createFlatImageData(outSize, outSize, [185, 145, 95])
    const points = intersections(boardSize, outSize)

    const whiteIndex = 1 * boardSize + 1
    const brightHighlightIndex = 6 * boardSize + 6

    drawDisc(
      imageData,
      Math.round(points[whiteIndex].x),
      Math.round(points[whiteIndex].y),
      4,
      [246, 246, 246],
    )
    drawDisc(
      imageData,
      Math.round(points[brightHighlightIndex].x),
      Math.round(points[brightHighlightIndex].y),
      4,
      [250, 220, 30],
    )

    const board = estimateBoardStones(imageData, points, 9)

    expect(board[whiteIndex]).toBe('W')
    expect(board[brightHighlightIndex]).toBe('E')
  })

  test('postprocess keeps high-confidence seed stone even if surrounded', () => {
    const boardSize = 9
    const outSize = 150
    const imageData = createSyntheticImageData(outSize, outSize, 145)
    const points = intersections(boardSize, outSize)

    const center = 4 * boardSize + 4
    const surround = [
      3 * boardSize + 3,
      3 * boardSize + 4,
      3 * boardSize + 5,
      4 * boardSize + 3,
      4 * boardSize + 5,
      5 * boardSize + 3,
      5 * boardSize + 4,
      5 * boardSize + 5,
    ]

    drawDisc(imageData, Math.round(points[center].x), Math.round(points[center].y), 7, [18, 18, 18])
    for (const idx of surround) {
      drawDisc(imageData, Math.round(points[idx].x), Math.round(points[idx].y), 7, [244, 244, 244])
    }

    const board = estimateBoardStones(imageData, points, 9)
    expect(board[center]).toBe('B')
  })

  test('postprocess removes isolated black when lock threshold is high', () => {
    const boardSize = 9
    const outSize = 150
    const imageData = createSyntheticImageData(outSize, outSize, 145)
    const points = intersections(boardSize, outSize)

    const center = 4 * boardSize + 4
    const surround = [
      3 * boardSize + 3,
      3 * boardSize + 4,
      3 * boardSize + 5,
      4 * boardSize + 3,
      4 * boardSize + 5,
      5 * boardSize + 3,
      5 * boardSize + 4,
      5 * boardSize + 5,
    ]

    drawDisc(imageData, Math.round(points[center].x), Math.round(points[center].y), 7, [18, 18, 18])
    for (const idx of surround) {
      drawDisc(imageData, Math.round(points[idx].x), Math.round(points[idx].y), 7, [244, 244, 244])
    }

    const board = estimateBoardStones(
      imageData,
      points,
      9,
      withOptions({
        postConfidenceLock: 2,
      }),
    )

    expect(board[center]).toBe('E')
  })
})
