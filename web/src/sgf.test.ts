import { describe, expect, test } from 'vitest'

import { buildPositionSgf } from './sgf'
import type { BoardState } from './types'

function emptyBoard(size: number): BoardState {
  return new Array(size * size).fill('E') as BoardState
}

describe('buildPositionSgf', () => {
  test('builds SGF with AB/AW/PL/KM and board size', () => {
    const board = emptyBoard(9)
    board[0] = 'B'
    board[8 * 9 + 8] = 'W'

    const sgf = buildPositionSgf({
      boardSize: 9,
      toPlay: 'W',
      komi: 6.5,
      board,
    })

    expect(sgf).toContain('SZ[9]')
    expect(sgf).toContain('KM[6.5]')
    expect(sgf).toContain('PL[W]')
    expect(sgf).toContain('AB[aa]')
    expect(sgf).toContain('AW[ii]')
  })

  test('formats integer komi with .0', () => {
    const board = emptyBoard(19)
    const sgf = buildPositionSgf({
      boardSize: 19,
      toPlay: 'B',
      komi: 7,
      board,
    })

    expect(sgf).toContain('KM[7.0]')
    expect(sgf).toContain('PL[B]')
  })
})
