# Quant-Alpha Live Signal & Macro Center

This package converts the supplied dashboard into a deployment-ready full-stack application.

## Architecture

Browser -> Express backend -> Twelve Data / economic provider -> browser

The Twelve Data API key stays on the server. The browser only calls your own `/api/*` endpoints.

Twelve Data documents `/time_series` for OHLC historical data and `/price`/exchange-rate endpoints for current market data. It also lists Nikkei 225 as `N225` and Gold Spot as `XAU/USD`. See https://twelvedata.com/docs.

The chart is the official TradingView Advanced Chart embed. See https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/.

## 1. Install

```bash
npm install
cp .env.example .env
```

Put your real API keys into `.env`.

## 2. Run locally

```bash
npm start
```

Open:

http://localhost:10000

## 3. Economic calendar

For full Actual / Forecast / Previous data, set `FINNHUB_API_KEY`.

If Finnhub is not configured, the backend can fall back to FRED release dates when `FRED_API_KEY` is configured. FRED release-date data does not itself provide the forecast/actual/previous values, so those cells can remain blank in fallback mode.

## 4. Deploy on Render

Create a Web Service from this folder.

Build command:
```bash
npm install
```

Start command:
```bash
npm start
```

Environment variables:
- TWELVE_DATA_API_KEY
- FINNHUB_API_KEY
- FRED_API_KEY (optional)
- MARKET_INTERVAL=15min
- TD_XAUUSD_SYMBOL=XAU/USD
- TD_JPN225_SYMBOL=N225

Render supplies PORT automatically.

Because Express serves the frontend from `/public`, you only need one web service.

## 5. Important data-plan note

Your data provider plan must allow the symbols and interval you select. Twelve Data applies plan-specific access and rate limits. If a symbol returns an access/plan error, change the symbol/plan rather than exposing a key in the frontend.

## 6. What is included

- Secure server-side market-data access
- XAUUSD, EURUSD, GBPUSD, USDJPY, JPN225/Nikkei 225, AUDUSD
- EMA 50 / EMA 200
- RSI
- ADX
- ATR-based illustrative SL / TP levels
- BUY / SELL / WAIT rules engine
- Live market cards
- Dynamic TradingView charts
- Economic calendar endpoint
- Macro surprise calculations
- FOMC monitoring
- Browser signal history
- Health endpoint: `/api/health`
- CORS configuration
- API error handling

The signal engine is rules-based analytical software, not investment advice and not a guarantee of future market movements.
