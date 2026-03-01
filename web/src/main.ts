import { z } from 'zod'

import { BoardRenderer } from './board'
import { clamp, mustGetElement } from './dom'
import { buildPositionSgf, downloadSgf } from './sgf'
import { createInitialState, reducer, type Action, type AppState } from './state'
import { DEFAULT_STONE_ESTIMATOR_OPTIONS } from './stone-config'
import { flipHorizontal, invertBlackWhite, rotateRight, toggleStoneAt } from './transforms'
import type { AppSettings, CornerPoints } from './types'
import {
  buildIntersectionsFromCalibratedGrid,
  calibrateGridLines,
  createDefaultCorners,
  estimateBoardStones,
  imageDataToDataUrl,
  warpBoard,
} from './vision'
import './style.css'

const WARP_SIZE = 1024
const CORNER_PICK_RADIUS = 28

const settingsSchema = z.object({
  boardSize: z.enum(['9', '13', '19']).transform((value) => Number(value) as 9 | 13 | 19),
  toPlay: z.enum(['B', 'W']),
  komi: z.coerce.number().min(-50).max(50),
})

const app = mustGetElement<HTMLDivElement>('#app')
app.innerHTML = `
  <main class="container">
    <header class="header">
      <h1>GobanLens</h1>
      <p class="subtitle">囲碁盤写真を 1 局面 SGF に変換</p>
      <p id="status" class="status">初期化中...</p>
      <p id="error" class="error" role="alert"></p>
    </header>

    <section id="home-view" class="card view">
      <h2>1. 入力設定</h2>
      <label class="field">
        <span>盤サイズ</span>
        <select id="board-size">
          <option value="19">19路盤</option>
          <option value="13">13路盤</option>
          <option value="9">9路盤</option>
        </select>
      </label>
      <label class="field">
        <span>次に打つ番</span>
        <select id="to-play">
          <option value="B">黒 (B)</option>
          <option value="W">白 (W)</option>
        </select>
      </label>
      <label class="field">
        <span>コミ</span>
        <input id="komi" type="number" step="0.5" value="6.5" />
      </label>
      <label class="field file-field">
        <span>盤画像</span>
        <input id="image-file" type="file" accept="image/*" />
      </label>
      <p class="hint">画像を選択すると Crop 画面へ進みます。</p>
    </section>

    <section id="crop-view" class="card view" hidden>
      <div class="view-head">
        <h2>2. 四隅調整</h2>
        <button id="crop-back" type="button" class="ghost">Homeへ戻る</button>
      </div>
      <p class="hint">赤い点をドラッグして盤の四隅（左上→右上→右下→左下）を合わせてください。</p>
      <div class="canvas-wrap">
        <canvas id="crop-canvas" aria-label="盤面四隅調整"></canvas>
      </div>
      <label class="field field-compact">
        <span>四隅JSON（共有用）</span>
        <textarea id="corner-json-output" rows="8" readonly></textarea>
      </label>
      <div class="actions wrap">
        <button id="copy-corners-json" type="button" class="ghost">四隅JSONをコピー</button>
        <button id="run-warp" type="button">透視補正して次へ</button>
      </div>
    </section>

    <section id="verify-view" class="card view" hidden>
      <div class="view-head">
        <h2>3. 石修正</h2>
        <button id="verify-back" type="button" class="ghost">Cropへ戻る</button>
      </div>
      <p class="hint">盤の交点をタップ: 空→黒→白→空</p>
      <div class="verify-layout">
        <div class="verify-image-wrap">
          <img id="verify-image" alt="透視補正済み盤面" />
        </div>
        <div id="board-root" class="board-root" aria-label="盤面編集"></div>
      </div>
      <div class="actions wrap">
        <button id="invert-bw" type="button" class="ghost">黒白反転</button>
        <button id="rotate-right" type="button" class="ghost">90度回転</button>
        <button id="flip-horizontal" type="button" class="ghost">左右反転</button>
        <button id="to-export" type="button">SGF 出力へ</button>
      </div>
    </section>

    <section id="export-view" class="card view" hidden>
      <div class="view-head">
        <h2>4. SGF出力</h2>
        <button id="export-back" type="button" class="ghost">Verifyへ戻る</button>
      </div>
      <label class="field">
        <span>SGF</span>
        <textarea id="sgf-output" rows="10" readonly></textarea>
      </label>
      <div class="actions wrap">
        <button id="download-sgf" type="button">SGF ダウンロード</button>
        <button id="copy-sgf" type="button" class="ghost">コピー</button>
        <button id="restart" type="button" class="ghost danger">最初からやり直す</button>
      </div>
    </section>
  </main>
`

const homeView = mustGetElement<HTMLElement>('#home-view')
const cropView = mustGetElement<HTMLElement>('#crop-view')
const verifyView = mustGetElement<HTMLElement>('#verify-view')
const exportView = mustGetElement<HTMLElement>('#export-view')

const statusEl = mustGetElement<HTMLParagraphElement>('#status')
const errorEl = mustGetElement<HTMLParagraphElement>('#error')

const boardSizeInput = mustGetElement<HTMLSelectElement>('#board-size')
const toPlayInput = mustGetElement<HTMLSelectElement>('#to-play')
const komiInput = mustGetElement<HTMLInputElement>('#komi')
const imageFileInput = mustGetElement<HTMLInputElement>('#image-file')

const cropCanvas = mustGetElement<HTMLCanvasElement>('#crop-canvas')
const cornerJsonOutput = mustGetElement<HTMLTextAreaElement>('#corner-json-output')
const copyCornersJsonButton = mustGetElement<HTMLButtonElement>('#copy-corners-json')
const cropBackButton = mustGetElement<HTMLButtonElement>('#crop-back')
const runWarpButton = mustGetElement<HTMLButtonElement>('#run-warp')

const verifyBackButton = mustGetElement<HTMLButtonElement>('#verify-back')
const verifyImage = mustGetElement<HTMLImageElement>('#verify-image')
const boardRoot = mustGetElement<HTMLDivElement>('#board-root')
const invertBwButton = mustGetElement<HTMLButtonElement>('#invert-bw')
const rotateRightButton = mustGetElement<HTMLButtonElement>('#rotate-right')
const flipHorizontalButton = mustGetElement<HTMLButtonElement>('#flip-horizontal')
const toExportButton = mustGetElement<HTMLButtonElement>('#to-export')

const exportBackButton = mustGetElement<HTMLButtonElement>('#export-back')
const sgfOutput = mustGetElement<HTMLTextAreaElement>('#sgf-output')
const downloadSgfButton = mustGetElement<HTMLButtonElement>('#download-sgf')
const copySgfButton = mustGetElement<HTMLButtonElement>('#copy-sgf')
const restartButton = mustGetElement<HTMLButtonElement>('#restart')

let state = createInitialState()
let boardRenderer: BoardRenderer | null = null
let draggingCornerIndex: number | null = null

function dispatch(action: Action): void {
  state = reducer(state, action)
  render()
}

function setError(message: string): void {
  dispatch({ type: 'SET_ERROR', error: message })
}

function readSettings(): AppSettings {
  const parsed = settingsSchema.safeParse({
    boardSize: boardSizeInput.value,
    toPlay: toPlayInput.value,
    komi: komiInput.value,
  })

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? '設定値が不正です')
  }

  return parsed.data
}

function syncInputsFromState(): void {
  boardSizeInput.value = String(state.settings.boardSize)
  toPlayInput.value = state.settings.toPlay
  komiInput.value = `${state.settings.komi}`
}

function showView(viewName: AppState['view']): void {
  homeView.hidden = viewName !== 'home'
  cropView.hidden = viewName !== 'crop'
  verifyView.hidden = viewName !== 'verify'
  exportView.hidden = viewName !== 'export'
}

function drawCropCanvas(): void {
  if (!state.sourceImage || !state.corners) {
    return
  }

  const image = state.sourceImage
  cropCanvas.width = image.naturalWidth
  cropCanvas.height = image.naturalHeight

  const ctx = cropCanvas.getContext('2d')
  if (!ctx) {
    return
  }

  ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height)
  ctx.drawImage(image, 0, 0, cropCanvas.width, cropCanvas.height)

  ctx.strokeStyle = '#ff3b30'
  ctx.lineWidth = Math.max(2, cropCanvas.width / 500)
  ctx.beginPath()
  ctx.moveTo(state.corners[0].x, state.corners[0].y)
  ctx.lineTo(state.corners[1].x, state.corners[1].y)
  ctx.lineTo(state.corners[2].x, state.corners[2].y)
  ctx.lineTo(state.corners[3].x, state.corners[3].y)
  ctx.closePath()
  ctx.stroke()

  const labels = ['TL', 'TR', 'BR', 'BL']
  state.corners.forEach((point, index) => {
    ctx.beginPath()
    ctx.fillStyle = '#ff3b30'
    ctx.arc(point.x, point.y, Math.max(7, cropCanvas.width / 100), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.max(13, cropCanvas.width / 55)}px sans-serif`
    ctx.fillText(labels[index], point.x + 10, point.y - 10)
  })
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100
}

function buildCornersExportText(): string {
  if (!state.sourceImage || !state.corners) {
    return ''
  }

  const payload = {
    boardSize: state.settings.boardSize,
    cornerOrder: ['TL', 'TR', 'BR', 'BL'],
    imageSize: {
      width: state.sourceImage.naturalWidth,
      height: state.sourceImage.naturalHeight,
    },
    corners: state.corners.map((point) => ({
      x: roundCoord(point.x),
      y: roundCoord(point.y),
    })),
  }

  return JSON.stringify(payload, null, 2)
}

function toCanvasPoint(event: PointerEvent): { x: number; y: number } {
  const rect = cropCanvas.getBoundingClientRect()
  const scaleX = cropCanvas.width / rect.width
  const scaleY = cropCanvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

function findNearestCorner(point: { x: number; y: number }, corners: CornerPoints): number {
  let nearest = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < corners.length; i += 1) {
    const dx = corners[i].x - point.x
    const dy = corners[i].y - point.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance < nearestDistance) {
      nearest = i
      nearestDistance = distance
    }
  }

  return nearestDistance <= CORNER_PICK_RADIUS ? nearest : -1
}

function render(): void {
  showView(state.view)
  syncInputsFromState()

  statusEl.textContent = state.status
  errorEl.textContent = state.error

  if (state.view === 'crop') {
    drawCropCanvas()
    cornerJsonOutput.value = buildCornersExportText()
  }

  if (state.warped?.dataUrl) {
    verifyImage.src = state.warped.dataUrl
  }

  if (state.view === 'verify' && state.board) {
    if (!boardRenderer) {
      boardRenderer = new BoardRenderer(boardRoot, state.settings.boardSize, (row, col) => {
        if (!state.board) {
          return
        }
        dispatch({
          type: 'SET_BOARD',
          board: toggleStoneAt(state.board, state.settings.boardSize, row, col),
        })
      })
    }
    boardRenderer.update(state.board, state.settings.boardSize)
  }

  if (state.view !== 'verify' && boardRenderer) {
    boardRenderer.destroy()
    boardRenderer = null
  }

  if (state.view === 'export') {
    sgfOutput.value = state.sgf
  }
}

async function loadImageFromFile(file: File): Promise<{ image: HTMLImageElement; dataUrl: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('画像読み込みに失敗しました'))
    reader.onload = () => {
      const value = reader.result
      if (typeof value !== 'string') {
        reject(new Error('画像データの形式が不正です'))
        return
      }
      resolve(value)
    }
    reader.readAsDataURL(file)
  })

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const imageElement = new Image()
    imageElement.onerror = () => reject(new Error('画像のデコードに失敗しました'))
    imageElement.onload = () => resolve(imageElement)
    imageElement.src = dataUrl
  })

  return { image, dataUrl }
}

boardSizeInput.addEventListener('change', () => {
  try {
    dispatch({ type: 'SET_SETTINGS', settings: readSettings() })
  } catch (error) {
    setError(error instanceof Error ? error.message : '設定の更新に失敗しました')
  }
})

toPlayInput.addEventListener('change', () => {
  try {
    dispatch({ type: 'SET_SETTINGS', settings: readSettings() })
  } catch (error) {
    setError(error instanceof Error ? error.message : '設定の更新に失敗しました')
  }
})

komiInput.addEventListener('change', () => {
  try {
    dispatch({ type: 'SET_SETTINGS', settings: readSettings() })
  } catch (error) {
    setError(error instanceof Error ? error.message : '設定の更新に失敗しました')
  }
})

imageFileInput.addEventListener('change', async () => {
  const file = imageFileInput.files?.[0]
  if (!file) {
    return
  }

  try {
    const settings = readSettings()
    dispatch({ type: 'SET_SETTINGS', settings })
    dispatch({ type: 'SET_STATUS', status: '画像を読み込み中...' })
    dispatch({ type: 'SET_ERROR', error: '' })

    const loaded = await loadImageFromFile(file)
    const corners = createDefaultCorners(loaded.image)
    dispatch({
      type: 'SET_SOURCE_IMAGE',
      image: loaded.image,
      dataUrl: loaded.dataUrl,
      corners,
    })
  } catch (error) {
    setError(error instanceof Error ? error.message : '画像読込に失敗しました')
  } finally {
    imageFileInput.value = ''
  }
})

cropBackButton.addEventListener('click', () => {
  dispatch({ type: 'SET_VIEW', view: 'home' })
  dispatch({ type: 'SET_STATUS', status: '画像を選択してください。' })
})

runWarpButton.addEventListener('click', async () => {
  if (!state.sourceImage || !state.corners) {
    setError('先に画像を読み込んでください')
    return
  }

  try {
    dispatch({ type: 'SET_STATUS', status: 'OpenCVで透視補正中...' })
    dispatch({ type: 'SET_ERROR', error: '' })

    const warpedImageData = await warpBoard(state.sourceImage, state.corners, WARP_SIZE)
    const calibrated = calibrateGridLines(warpedImageData, state.settings.boardSize, 4)
    const intersections = buildIntersectionsFromCalibratedGrid(calibrated)
    const estimated = estimateBoardStones(
      warpedImageData,
      intersections,
      state.settings.boardSize,
      DEFAULT_STONE_ESTIMATOR_OPTIONS,
    )

    dispatch({
      type: 'SET_WARPED',
      warped: {
        imageData: warpedImageData,
        dataUrl: imageDataToDataUrl(warpedImageData),
      },
      board: estimated,
    })
  } catch (error) {
    setError(
      error instanceof Error
        ? `透視補正または石推定に失敗しました: ${error.message}`
        : '透視補正または石推定に失敗しました',
    )
  }
})

copyCornersJsonButton.addEventListener('click', async () => {
  const content = cornerJsonOutput.value.trim()
  if (!content) {
    setError('四隅JSONがありません')
    return
  }

  try {
    await navigator.clipboard.writeText(content)
    dispatch({ type: 'SET_STATUS', status: '四隅JSONをコピーしました。' })
  } catch {
    setError('四隅JSONのコピーに失敗しました')
  }
})

cropCanvas.addEventListener('pointerdown', (event) => {
  if (!state.corners || state.view !== 'crop') {
    return
  }

  const point = toCanvasPoint(event)
  const nearest = findNearestCorner(point, state.corners)
  if (nearest === -1) {
    return
  }

  draggingCornerIndex = nearest
  cropCanvas.setPointerCapture(event.pointerId)
})

cropCanvas.addEventListener('pointermove', (event) => {
  if (draggingCornerIndex === null || !state.corners || !state.sourceImage) {
    return
  }

  const sourceImage = state.sourceImage
  const point = toCanvasPoint(event)
  const nextCorners: CornerPoints = state.corners.map((corner, index) => {
    if (index !== draggingCornerIndex) {
      return corner
    }

    return {
      x: clamp(point.x, 0, sourceImage.naturalWidth - 1),
      y: clamp(point.y, 0, sourceImage.naturalHeight - 1),
    }
  }) as CornerPoints

  dispatch({ type: 'SET_CORNERS', corners: nextCorners })
})

cropCanvas.addEventListener('pointerup', (event) => {
  if (draggingCornerIndex !== null) {
    cropCanvas.releasePointerCapture(event.pointerId)
  }
  draggingCornerIndex = null
})

cropCanvas.addEventListener('pointercancel', (event) => {
  if (draggingCornerIndex !== null) {
    cropCanvas.releasePointerCapture(event.pointerId)
  }
  draggingCornerIndex = null
})

verifyBackButton.addEventListener('click', () => {
  dispatch({ type: 'SET_VIEW', view: 'crop' })
  dispatch({ type: 'SET_STATUS', status: '四隅を調整して、透視補正してください。' })
})

invertBwButton.addEventListener('click', () => {
  if (!state.board) {
    return
  }
  dispatch({ type: 'SET_BOARD', board: invertBlackWhite(state.board) })
})

rotateRightButton.addEventListener('click', () => {
  if (!state.board) {
    return
  }
  dispatch({
    type: 'SET_BOARD',
    board: rotateRight(state.board, state.settings.boardSize),
  })
})

flipHorizontalButton.addEventListener('click', () => {
  if (!state.board) {
    return
  }
  dispatch({
    type: 'SET_BOARD',
    board: flipHorizontal(state.board, state.settings.boardSize),
  })
})

toExportButton.addEventListener('click', () => {
  if (!state.board) {
    setError('盤面データがありません')
    return
  }

  try {
    const sgf = buildPositionSgf({
      boardSize: state.settings.boardSize,
      toPlay: state.settings.toPlay,
      komi: state.settings.komi,
      board: state.board,
    })
    dispatch({ type: 'SET_SGF', sgf })
  } catch (error) {
    setError(error instanceof Error ? error.message : 'SGF生成に失敗しました')
  }
})

exportBackButton.addEventListener('click', () => {
  dispatch({ type: 'SET_VIEW', view: 'verify' })
})

downloadSgfButton.addEventListener('click', () => {
  if (!state.sgf) {
    return
  }
  downloadSgf(state.sgf, `gobanlens-${Date.now()}.sgf`)
})

copySgfButton.addEventListener('click', async () => {
  if (!state.sgf) {
    return
  }

  try {
    await navigator.clipboard.writeText(state.sgf)
    dispatch({ type: 'SET_STATUS', status: 'SGFをコピーしました。' })
  } catch {
    setError('クリップボードへのコピーに失敗しました')
  }
})

restartButton.addEventListener('click', () => {
  dispatch({ type: 'RESET' })
})

render()
