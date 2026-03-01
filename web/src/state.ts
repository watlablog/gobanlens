import type {
  AppSettings,
  BoardState,
  CornerPoints,
  ViewName,
  WarpResult,
} from './types'

export type AppState = {
  view: ViewName
  settings: AppSettings
  sourceImage: HTMLImageElement | null
  sourceDataUrl: string | null
  corners: CornerPoints | null
  warped: WarpResult | null
  board: BoardState | null
  sgf: string
  status: string
  error: string
}

export type Action =
  | { type: 'SET_VIEW'; view: ViewName }
  | { type: 'SET_SETTINGS'; settings: AppSettings }
  | {
      type: 'SET_SOURCE_IMAGE'
      image: HTMLImageElement
      dataUrl: string
      corners: CornerPoints
    }
  | { type: 'SET_CORNERS'; corners: CornerPoints }
  | { type: 'SET_WARPED'; warped: WarpResult; board: BoardState }
  | { type: 'SET_BOARD'; board: BoardState }
  | { type: 'SET_SGF'; sgf: string }
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }

const initialSettings: AppSettings = {
  boardSize: 19,
  toPlay: 'B',
  komi: 6.5,
}

export function createInitialState(): AppState {
  return {
    view: 'home',
    settings: initialSettings,
    sourceImage: null,
    sourceDataUrl: null,
    corners: null,
    warped: null,
    board: null,
    sgf: '',
    status: '画像を選択してください。',
    error: '',
  }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_VIEW':
      return {
        ...state,
        view: action.view,
      }
    case 'SET_SETTINGS':
      return {
        ...state,
        settings: action.settings,
      }
    case 'SET_SOURCE_IMAGE':
      return {
        ...state,
        sourceImage: action.image,
        sourceDataUrl: action.dataUrl,
        corners: action.corners,
        warped: null,
        board: null,
        sgf: '',
        view: 'crop',
        status: '四隅を調整して、透視補正してください。',
        error: '',
      }
    case 'SET_CORNERS':
      return {
        ...state,
        corners: action.corners,
      }
    case 'SET_WARPED':
      return {
        ...state,
        warped: action.warped,
        board: action.board,
        view: 'verify',
        status: '推定結果を確認して修正してください。',
        error: '',
      }
    case 'SET_BOARD':
      return {
        ...state,
        board: action.board,
      }
    case 'SET_SGF':
      return {
        ...state,
        sgf: action.sgf,
        view: 'export',
        status: 'SGFを保存またはコピーできます。',
        error: '',
      }
    case 'SET_STATUS':
      return {
        ...state,
        status: action.status,
      }
    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
      }
    case 'RESET':
      return createInitialState()
    default:
      return state
  }
}
