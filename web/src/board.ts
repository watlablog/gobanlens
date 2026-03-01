import type { BoardSize, BoardState } from './types'

type StoneObject = {
  x: number
  y: number
  c: number
}

type WGoBoardInstance = {
  removeAllObjects: () => void
  addObject: (obj: StoneObject) => void
  addEventListener: (eventName: string, listener: (x: number, y: number) => void) => void
  setSize?: (size: number) => void
}

type WGoGlobal = {
  B: number
  W: number
  Board: new (
    container: HTMLElement,
    options: {
      size: number
      width: number
    },
  ) => WGoBoardInstance
}

declare global {
  interface Window {
    WGo?: WGoGlobal
  }
}

type ClickHandler = (row: number, col: number) => void

function drawFallbackBoard(
  canvas: HTMLCanvasElement,
  board: BoardState,
  boardSize: BoardSize,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  const width = canvas.width
  const step = width / (boardSize + 1)

  ctx.clearRect(0, 0, width, width)
  ctx.fillStyle = '#d6b276'
  ctx.fillRect(0, 0, width, width)

  ctx.strokeStyle = '#5e4023'
  ctx.lineWidth = 1
  for (let i = 0; i < boardSize; i += 1) {
    const p = step * (i + 1)
    ctx.beginPath()
    ctx.moveTo(step, p)
    ctx.lineTo(step * boardSize, p)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(p, step)
    ctx.lineTo(p, step * boardSize)
    ctx.stroke()
  }

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const stone = board[row * boardSize + col]
      if (stone === 'E') {
        continue
      }
      const cx = step * (col + 1)
      const cy = step * (row + 1)
      const radius = step * 0.42

      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = stone === 'B' ? '#111' : '#f5f5f5'
      ctx.fill()
      ctx.strokeStyle = stone === 'B' ? '#000' : '#777'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

export class BoardRenderer {
  private readonly container: HTMLElement
  private readonly onClick: ClickHandler
  private wgoBoard: WGoBoardInstance | null = null
  private fallbackCanvas: HTMLCanvasElement | null = null
  private board: BoardState = []
  private boardSize: BoardSize = 19

  constructor(container: HTMLElement, boardSize: BoardSize, onClick: ClickHandler) {
    this.container = container
    this.boardSize = boardSize
    this.onClick = onClick
    this.initialize()
  }

  private initialize(): void {
    const wgo = window.WGo
    const width = Math.max(320, Math.min(760, this.container.clientWidth || 640))

    this.container.innerHTML = ''

    if (wgo) {
      this.wgoBoard = new wgo.Board(this.container, {
        size: this.boardSize,
        width,
      })
      this.wgoBoard.addEventListener('click', (x, y) => {
        this.onClick(y, x)
      })
      return
    }

    this.fallbackCanvas = document.createElement('canvas')
    this.fallbackCanvas.width = width
    this.fallbackCanvas.height = width
    this.fallbackCanvas.className = 'board-canvas'
    this.container.appendChild(this.fallbackCanvas)
    this.fallbackCanvas.addEventListener('click', (event) => {
      const rect = this.fallbackCanvas?.getBoundingClientRect()
      if (!rect || !this.fallbackCanvas) {
        return
      }
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const step = this.fallbackCanvas.width / (this.boardSize + 1)
      const col = Math.max(0, Math.min(this.boardSize - 1, Math.round(localX / step) - 1))
      const row = Math.max(0, Math.min(this.boardSize - 1, Math.round(localY / step) - 1))
      this.onClick(row, col)
    })
  }

  public update(board: BoardState, boardSize: BoardSize): void {
    this.board = board

    if (this.boardSize !== boardSize) {
      this.boardSize = boardSize
      if (this.wgoBoard?.setSize) {
        this.wgoBoard.setSize(boardSize)
      }
      if (this.fallbackCanvas) {
        drawFallbackBoard(this.fallbackCanvas, this.board, this.boardSize)
      }
    }

    if (this.wgoBoard) {
      this.wgoBoard.removeAllObjects()
      board.forEach((stone, index) => {
        const row = Math.floor(index / this.boardSize)
        const col = index % this.boardSize
        if (stone === 'B') {
          this.wgoBoard?.addObject({ x: col, y: row, c: window.WGo?.B ?? 1 })
        } else if (stone === 'W') {
          this.wgoBoard?.addObject({ x: col, y: row, c: window.WGo?.W ?? -1 })
        }
      })
      return
    }

    if (this.fallbackCanvas) {
      drawFallbackBoard(this.fallbackCanvas, board, this.boardSize)
    }
  }

  public destroy(): void {
    this.container.innerHTML = ''
    this.wgoBoard = null
    this.fallbackCanvas = null
  }
}
