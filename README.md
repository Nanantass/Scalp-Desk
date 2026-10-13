# ScalpDesk

Personal crypto scalping dashboard for Bybit -- by Nathan Hydroponicera.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create env file
cp .env.example .env
# Edit .env: isi VITE_ANTHROPIC_API_KEY dari console.anthropic.com

# 3. Run
npm run dev
# Buka http://localhost:3000
```

## Features
- AI Trading Plan (Claude Sonnet)
- Live prices: CoinGecko -> Bybit Spot -> Binance -> Static
- Trade Journal + Edit/Delete
- PnL Calendar Heatmap
- Performance Stats + Radar Chart
- Multi-symbol Scanner
- AI Review Agent
- Telegram copy / Export .txt

## Stack
React 18 + Vite 5 + Claude API + CoinGecko API
