# DuoTalk — 雙機對話錄影

兩台手機同步錄影，自動合成並排對話影片。

## 架構

```
public/index.html   — 前端 PWA（Void Gold 設計系統）
server/index.js     — Node.js WebSocket signaling server
```

## 本地測試

```bash
npm install
npm start
# 開啟 http://localhost:3000
# 兩個瀏覽器分頁 / 兩台手機（同 WiFi）同時連線
```

## 部署到 Railway

1. 建立 GitHub repo，push 此專案
2. 到 [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. 選此 repo → 自動偵測 Node.js → Deploy
4. Settings → Generate Domain → 取得公開 URL
5. 兩台手機用同一 URL，跨網路也能用

## 部署到 Render（免費替代）

1. [render.com](https://render.com) → New Web Service
2. 連 GitHub repo
3. Build Command: `npm install`
4. Start Command: `node server/index.js`
5. Instance Type: Free

## 訊息協定

| 方向 | 類型 | 說明 |
|------|------|------|
| C→S | `CREATE_ROOM` | 主機建立房間 |
| S→C | `ROOM_CREATED` | 回傳 4 碼房間號 |
| C→S | `JOIN_ROOM` | 客機加入 |
| S→C | `JOIN_OK` / `GUEST_JOINED` | 配對確認 |
| C→S | `START_COUNTDOWN` | 主機發起倒數 |
| S→C | `START_COUNTDOWN` | 廣播給雙方 |
| C→S | Binary ArrayBuffer | 影片 chunk 即時轉傳 |
| C→S | `RELAY PARTNER_DONE` | 通知對方錄影完成 |
| S→C | `PARTNER_LEFT` | 對方離線通知 |

## 下一步

- [ ] 加 ffmpeg 後端合成（品質更好）
- [ ] 加 Whisper 字幕
- [ ] 加 Claude API 對話摘要
- [ ] LINE Bot 通知 / 分享
