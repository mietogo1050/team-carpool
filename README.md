# チーム配車

スポーツチームの活動ごとに、参加・配車のアンケートをとり、配車と道路料金を決めて LINE で共有するウェブアプリです。

- 画面：このリポジトリ（GitHub Pages で公開。ビルド不要の HTML / CSS / JavaScript）
- データ：Google Apps Script のウェブアプリ（API）経由で Google スプレッドシートに保存
- 接続先は `src/config.js` の `API_URL`

## 手元での確認

```
python -m http.server 8765
```

- `http://localhost:8765/` … ブラウザ内だけに保存する開発用の画面
- `http://localhost:8765/test/` … ロジックのテスト
- `http://localhost:8765/test/api-harness.html#/` … API 経由の動きを手元で再現（データは模擬）
