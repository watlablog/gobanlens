# GobanLens

GobanLens は、囲碁盤の写真を 1 局面として取り込み、盤面修正後に SGF を出力する Web アプリです。

このリポジトリは **MVP Step1-3**（画像入力 / 四隅補正 / 石修正 / SGF 出力）を実装します。

## Tech stack

- Frontend: Vite + Vanilla TypeScript
- Vision: OpenCV.js (`@techstark/opencv-js`)
- Board UI: WGo.js（`web/public/vendor/wgo.js`）
- Hosting: Firebase Hosting

## Setup

```bash
cd web
npm install
cp .env.example .env.local
```

`.env.local` の `VITE_*` 値を Firebase Web App 設定で更新してください。

## Local development

```bash
cd web
npm run dev
```

## Build

```bash
cd web
npm run build
```

## Sample Evaluation (stone detection)

```bash
python3 -m venv tools/stone_eval/.venv
tools/stone_eval/.venv/bin/pip install -r tools/stone_eval/requirements.txt

tools/stone_eval/.venv/bin/python tools/stone_eval/evaluate.py \
  --image sample/igo-19.jpg \
  --meta sample/igo-19.meta.json \
  --labels sample/igo-19.labels.json \
  --grid-search
```

評価結果は `tools/stone_eval/out/igo-19/best_result.json` に保存されます。

## Label JSON 作成GUI

黒石・白石を手入力して `labels.json` を作る場合:

```bash
/usr/bin/python3 -m venv tools/stone_eval/.venv-tk
tools/stone_eval/.venv-tk/bin/python tools/stone_eval/board_labeler.py --board-size 19
```

- 交点クリックで `空 -> 黒 -> 白 -> 空`
- `JSON保存` で `sample/igo-19.labels.json` などへ保存
- 出力形式:
  - `boardSize`
  - `black` (SGF座標配列)
  - `white` (SGF座標配列)
- Homebrew Python で `tkinter` が使えない場合があるため、GUI は `/usr/bin/python3` 由来の `.venv-tk` を推奨

SGFから labels JSON へ変換する場合:

```bash
python3 tools/stone_eval/sgf_to_labels_json.py \
  --input sample/position.sgf \
  --output sample/igo-19.labels.json
```

## Deploy (Firebase Hosting)

```bash
cd web
npm run build
cd ..
firebase deploy --only hosting
```

## Current scope (Step1-3)

- 画像アップロード
- 盤四隅 4 点調整 + 透視変換
- 交点ごとの石推定（黒/白/空）
- 盤面修正（タップトグル、反転、回転）
- SGF 生成（AB/AW + PL + KM）

## Next steps

1. Step4: ブラウザカメラ撮影入力（`getUserMedia`）
2. Step5: KataGo 解析 API（Cloud Run + FastAPI）
