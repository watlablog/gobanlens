import type { BoardSize, BoardState, Stone } from './types'

function indexOf(boardSize: BoardSize, row: number, col: number): number {
  return row * boardSize + col
}

export function toggleStone(stone: Stone): Stone {
  if (stone === 'E') {
    return 'B'
  }
  if (stone === 'B') {
    return 'W'
  }
  return 'E'
}

export function invertBlackWhite(board: BoardState): BoardState {
  return board.map((stone) => {
    if (stone === 'B') {
      return 'W'
    }
    if (stone === 'W') {
      return 'B'
    }
    return 'E'
  })
}

export function rotateRight(board: BoardState, boardSize: BoardSize): BoardState {
  const rotated: BoardState = new Array(board.length).fill('E') as BoardState
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const src = indexOf(boardSize, row, col)
      const dst = indexOf(boardSize, col, boardSize - 1 - row)
      rotated[dst] = board[src]
    }
  }
  return rotated
}

export function flipHorizontal(board: BoardState, boardSize: BoardSize): BoardState {
  const flipped: BoardState = new Array(board.length).fill('E') as BoardState
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const src = indexOf(boardSize, row, col)
      const dst = indexOf(boardSize, row, boardSize - 1 - col)
      flipped[dst] = board[src]
    }
  }
  return flipped
}

export function toggleStoneAt(
  board: BoardState,
  boardSize: BoardSize,
  row: number,
  col: number,
): BoardState {
  const index = indexOf(boardSize, row, col)
  const next = board.slice()
  next[index] = toggleStone(next[index])
  return next
}
