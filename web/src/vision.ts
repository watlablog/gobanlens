import cvModule from '@techstark/opencv-js'

import type { BoardSize, CornerPoints, Point } from './types'

type OpenCvLike = {
  Mat: new () => OpenCvMat
  Size: new (width: number, height: number) => unknown
  Scalar: new (...values: number[]) => unknown
  CV_32FC2: number
  INTER_LINEAR: number
  BORDER_REPLICATE: number
  COLOR_RGB2RGBA: number
  matFromArray: (rows: number, cols: number, type: number, data: number[]) => OpenCvMat
  matFromImageData: (imageData: ImageData) => OpenCvMat
  getPerspectiveTransform: (src: OpenCvMat, dst: OpenCvMat) => OpenCvMat
  warpPerspective: (
    src: OpenCvMat,
    dst: OpenCvMat,
    matrix: OpenCvMat,
    dsize: unknown,
    flags: number,
    borderMode: number,
    borderValue: unknown,
  ) => void
  cvtColor: (src: OpenCvMat, dst: OpenCvMat, code: number, dstCn?: number) => void
  onRuntimeInitialized?: () => void
}

type OpenCvMat = {
  rows: number
  cols: number
  data: Uint8Array
  channels: () => number
  delete: () => void
}

let cachedCv: OpenCvLike | null = null
let openCvReadyPromise: Promise<void> | null = null

async function resolveCv(): Promise<OpenCvLike> {
  if (cachedCv) {
    return cachedCv
  }

  const maybePromise = cvModule as unknown as Promise<OpenCvLike>
  const cv =
    typeof (maybePromise as { then?: unknown }).then === 'function'
      ? await maybePromise
      : (cvModule as unknown as OpenCvLike)

  cachedCv = cv
  return cv
}

export async function initOpenCv(): Promise<void> {
  if (openCvReadyPromise) {
    await openCvReadyPromise
    return
  }

  openCvReadyPromise = (async () => {
    const cv = await resolveCv()
    if (typeof cv.Mat === 'function') {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('OpenCV initialization timeout'))
      }, 15000)

      cv.onRuntimeInitialized = () => {
        window.clearTimeout(timeout)
        resolve()
      }
    })
  })()

  await openCvReadyPromise
}

function imageToImageData(image: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas')
  const width = image.naturalWidth
  const height = image.naturalHeight
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create image context')
  }
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

export function createDefaultCorners(image: HTMLImageElement): CornerPoints {
  const marginX = image.naturalWidth * 0.08
  const marginY = image.naturalHeight * 0.08
  return [
    { x: marginX, y: marginY },
    { x: image.naturalWidth - marginX, y: marginY },
    { x: image.naturalWidth - marginX, y: image.naturalHeight - marginY },
    { x: marginX, y: image.naturalHeight - marginY },
  ]
}

export async function warpBoard(
  image: HTMLImageElement,
  corners: CornerPoints,
  outSize: number,
): Promise<ImageData> {
  await initOpenCv()
  const cv = await resolveCv()

  const sourceImageData = imageToImageData(image)
  const src = cv.matFromImageData(sourceImageData)
  const dst = new cv.Mat()
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x,
    corners[0].y,
    corners[1].x,
    corners[1].y,
    corners[2].x,
    corners[2].y,
    corners[3].x,
    corners[3].y,
  ])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    outSize - 1,
    0,
    outSize - 1,
    outSize - 1,
    0,
    outSize - 1,
  ])

  const transform = cv.getPerspectiveTransform(srcTri, dstTri)
  cv.warpPerspective(
    src,
    dst,
    transform,
    new cv.Size(outSize, outSize),
    cv.INTER_LINEAR,
    cv.BORDER_REPLICATE,
    new cv.Scalar(0, 0, 0, 255),
  )

  let output = dst
  let temp: OpenCvMat | null = null
  if (dst.channels() === 3) {
    temp = new cv.Mat()
    cv.cvtColor(dst, temp, cv.COLOR_RGB2RGBA)
    output = temp
  }

  const pixelData = new Uint8ClampedArray(output.data)
  const result = new ImageData(pixelData, output.cols, output.rows)

  src.delete()
  dst.delete()
  srcTri.delete()
  dstTri.delete()
  transform.delete()
  if (temp) {
    temp.delete()
  }

  return result
}

export function buildIntersections(
  boardSize: BoardSize,
  outSize: number,
): Point[] {
  if (boardSize < 2) {
    throw new Error('boardSize must be at least 2')
  }

  const points: Point[] = []
  const step = (outSize - 1) / (boardSize - 1)
  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      points.push({
        x: col * step,
        y: row * step,
      })
    }
  }
  return points
}

export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create output context')
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export { buildIntersectionsFromCalibratedGrid, calibrateGridLines } from './grid-calibration'
export { estimateBoardStones } from './stone-estimator'
