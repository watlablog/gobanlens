import { describe, expect, test } from 'vitest'

import { flipHorizontal, invertBlackWhite, rotateRight, toggleStoneAt } from './transforms'
import type { BoardState } from './types'

function emptyBoard(): BoardState {
  return new Array(81).fill('E') as BoardState
}

function index(row: number, col: number): number {
  return row * 9 + col
}

describe('board transforms', () => {
  test('inverts black and white only', () => {
    const board = emptyBoard()
    board[index(0, 0)] = 'B'
    board[index(0, 1)] = 'W'
    const next = invertBlackWhite(board)

    expect(next[index(0, 0)]).toBe('W')
    expect(next[index(0, 1)]).toBe('B')
    expect(next[index(0, 2)]).toBe('E')
  })

  test('rotates board right (clockwise)', () => {
    const board = emptyBoard()
    board[index(0, 0)] = 'B'
    board[index(0, 8)] = 'W'
    board[index(3, 5)] = 'B'

    const rotated = rotateRight(board, 9)

    expect(rotated[index(0, 8)]).toBe('B')
    expect(rotated[index(8, 8)]).toBe('W')
    expect(rotated[index(5, 5)]).toBe('B')
  })

  test('flips board horizontally', () => {
    const board = emptyBoard()
    board[index(2, 1)] = 'B'
    board[index(4, 8)] = 'W'

    const flipped = flipHorizontal(board, 9)

    expect(flipped[index(2, 7)]).toBe('B')
    expect(flipped[index(4, 0)]).toBe('W')
  })

  test('toggles stone at selected intersection', () => {
    const board = emptyBoard()
    const once = toggleStoneAt(board, 9, 1, 1)
    const twice = toggleStoneAt(once, 9, 1, 1)
    const third = toggleStoneAt(twice, 9, 1, 1)

    expect(once[index(1, 1)]).toBe('B')
    expect(twice[index(1, 1)]).toBe('W')
    expect(third[index(1, 1)]).toBe('E')
  })
})
