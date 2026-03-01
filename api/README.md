# GobanLens API (placeholder)

現時点の GobanLens MVP は Firebase Hosting 上の `web/` のみで動作します。
この `api/` ディレクトリは Step5 で FastAPI + Cloud Run を導入するための雛形です。

## Planned endpoint

```http
POST /v1/analyze
Content-Type: application/json
Authorization: Bearer <optional>

{
  "sgf": "(;GM[1]FF[4]SZ[19]PL[B]AB[dd]AW[pp])",
  "komi": 6.5,
  "visits": 200,
  "max_moves": 5
}
```

Response example:

```json
{
  "bestMove": "qd",
  "candidates": [
    {
      "move": "qd",
      "winrate": 0.62,
      "scoreLead": 3.1,
      "pv": ["qd", "dp", "cq"]
    }
  ]
}
```

## Planned runtime

- Framework: FastAPI
- Deploy: Cloud Run
- Engine: KataGo (server-side)
