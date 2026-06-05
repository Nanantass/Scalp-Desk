# ⚡ Scalp Command Center

> Personal crypto scalping dashboard for **Bybit Perpetual** — built for high-probability intraday trading with AI-powered analysis.
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Claude AI](https://img.shields.io/badge/Claude-Sonnet_4-CC785C?logo=anthropic&logoColor=white)](https://anthropic.com)
[![Bybit](https://img.shields.io/badge/Bybit-Perpetual-F7A600?logo=bybit&logoColor=white)](https://bybit.com)
[![License](https://img.shields.io/badge/License-Personal-blue)](LICENSE)
---

## 📸 Features

| Feature | Description |
|---|---|
| 🤖 **AI Trading Plan** | Generate daily scalp setups powered by Claude AI — confidence filter ≥8/10, RR ≥1:2, liquidity sweep required |
| 📈 **Live Market Data** | Real-time prices from Bybit Perpetual API (fallback: Binance) — refreshes every 15 seconds |
| 📓 **Trade Journal** | Log trades with full details: Entry, SL, TP1, TP2, confidence, PnL — edit & delete anytime |
| 📅 **PnL Calendar** | Monthly heatmap showing daily profit/loss — green = profit, red = loss |
| 🏆 **Performance Stats** | Win Rate (gold if >60%), radar chart, P&L ranking by pair, time filters (7d/14d/30d/60d/90d/180d/custom) |
| ⚡ **Quick Add** | One-click add trade to journal directly from AI plan |

---

## 🛠 Tech Stack

- **React 18** + **Vite 5**
- **Claude API** (`claude-sonnet-4-20250514`) — AI trading analysis
- **Bybit V5 API** — live perpetual prices, OI, funding rate
- **localStorage** — trade journal & wallet persistence
- **Pure CSS** — IBM Plex Mono + Syne fonts, dark trading terminal aesthetic

---

## 🚀 Quick Start

### 1. Clone repo

```bash
git clone https://github.com/YOUR_USERNAME/scalp-command-center.git
cd scalp-command-center
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` dan isi API key:

```env
VITE_ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

Dapatkan API key di: [console.anthropic.com](https://console.anthropic.com/)

### 4. Run development server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
scalp-command-center/
├── src/
│   ├── main.jsx          # React entry point
│   └── App.jsx           # Main application component
├── public/               # Static assets
├── index.html            # HTML template
├── vite.config.js        # Vite + proxy config
├── package.json          # Dependencies & scripts
├── .env.example          # Environment variables template
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

---

## ⚙️ Configuration

### Pairs yang dimonitor

Edit `COIN_CFG` di `src/App.jsx`:

```js
const COIN_CFG = [
  { s:"BTC",  p:"BTCUSDT",  ... },
  { s:"ETH",  p:"ETHUSDT",  ... },
  { s:"SOL",  p:"SOLUSDT",  ... },
  { s:"HYPE", p:"HYPEUSDT", ... },
  { s:"ZEC",  p:"ZECUSDT",  ... },
  // Tambah pair baru di sini
];
```

### Initial wallet / capital

Bisa diubah langsung dari UI di tab **Stats** → tombol **✎ Edit Capital**.

### Risk management defaults

Edit konstanta di `App.jsx`:
```js
const [capital, setCap] = useState("500");  // Modal awal
const [risk,    setRisk]= useState("1");    // Risk % per trade
const [lev,     setLev] = useState("10");   // Leverage default
```

---

## 🔑 API Key Security

> ⚠️ **PENTING**: Jangan pernah commit file `.env` ke GitHub!

Untuk production/deployment, gunakan salah satu dari:

1. **Vercel** — tambahkan env var di dashboard Vercel
2. **Netlify** — tambahkan di Site Settings → Environment Variables
3. **Self-hosted** — gunakan proxy server Node.js untuk menyembunyikan API key

### Contoh proxy server sederhana (Node.js + Express)

```js
// server.js
import express from 'express'
import fetch from 'node-fetch'

const app = express()
app.use(express.json())

app.post('/api/chat', async (req, res) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(req.body),
  })
  const data = await response.json()
  res.json(data)
})

app.listen(8080)
```

---

## 📊 Trading Rules (Built-in)

- **Confidence filter**: ≥ 8/10 — setup di bawah ini otomatis diskip
- **RR minimum**: SL:TP1 = 1:2
- **Liquidity sweep**: wajib ada sebelum entry
- **Stop rule**: 2 loss berturut-turut → berhenti trading hari itu
- **Max setups**: 3 per hari

---

## 🐛 Known Issues

| Issue | Workaround |
|---|---|
| Bybit API offline | App otomatis fallback ke Binance, lalu static data |
| CORS pada Anthropic API | Gunakan proxy server atau deploy dengan server-side |
| HYPE tidak ada di Binance | Harga HYPE dari Bybit saja, tidak ada Binance fallback |

---

## 📝 Changelog

### v4.2 (Latest)
- ✅ Multi-source price fetch: Bybit → Binance → static fallback
- ✅ PnL Calendar heatmap per bulan
- ✅ P&L Ranking by pair (horizontal bar chart)
- ✅ Time filter stats: 7d / 14d / 30d / 60d / 90d / 180d / custom
- ✅ "Open" result untuk trade yang masih berjalan
- ✅ Win Rate gold shimmer jika >60%
- ✅ PnL 4 desimal

### v4.1
- ✅ Edit & delete journal entries
- ✅ Quick Add from AI plan to journal
- ✅ Stats tab: ML-style ring badges + spider chart
- ✅ Window.storage → localStorage (standalone)

---

## 👤 Author

**Nathan** — CEO Hydroponicera | Informatics Student @ Universitas Telkom Bandung

> *"Trade with discipline, not emotion."*

---

## ⚖️ Disclaimer

Tools ini dibuat untuk keperluan **personal & edukasi**. Bukan merupakan financial advice. Selalu gunakan risk management yang proper dan trade dengan modal yang siap hilang.

---

*Made with ☕ and Claude AI*
