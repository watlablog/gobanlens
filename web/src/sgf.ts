import type { BoardSize, BoardState, Player } from './types'

const SGF_COORDS = 'abcdefghijklmnopqrstuvwxyz'

type BuildSgfInput = {
  boardSize: BoardSize
  toPlay: Player
  komi: number
  board: BoardState
}

function toSgfCoord(row: number, col: number): string {
  const x = SGF_COORDS[col]
  const y = SGF_COORDS[row]
  if (!x || !y) {
    throw new Error('SGF coordinate out of range')
  }
  return `${x}${y}`
}

function formatKomi(komi: number): string {
  if (Number.isInteger(komi)) {
    return `${komi}.0`
  }
  return `${komi}`
}

export function buildPositionSgf(input: BuildSgfInput): string {
  const { boardSize, board, toPlay, komi } = input
  const blacks: string[] = []
  const whites: string[] = []

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const stone = board[row * boardSize + col]
      if (stone === 'B') {
        blacks.push(toSgfCoord(row, col))
      } else if (stone === 'W') {
        whites.push(toSgfCoord(row, col))
      }
    }
  }

  const ab = blacks.map((coord) => `[${coord}]`).join('')
  const aw = whites.map((coord) => `[${coord}]`).join('')

  return `(;GM[1]FF[4]CA[UTF-8]SZ[${boardSize}]KM[${formatKomi(komi)}]PL[${toPlay}]AB${ab}AW${aw})`
}

export function downloadSgf(sgf: string, filename = 'position.sgf'): void {
  const blob = new Blob([sgf], { type: 'application/x-go-sgf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
