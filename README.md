# BotCasino13

**ICT-Based Polymarket BTC Direction Trading Bot**

Turn $12 into $98,304 by winning 13 consecutive trades on Polymarket's Bitcoin Up/Down daily markets.

> ⚠️ **WARNING**: This is an extremely high-risk strategy. Read [PROBABILITY_ANALYSIS.md](./PROBABILITY_ANALYSIS.md) before proceeding.

---

## Overview

This bot implements ICT (Inner Circle Trader) concepts to predict daily Bitcoin direction for Polymarket binary outcome markets.

### The Challenge

```
$12 × 2^13 = $98,304
100% capital per trade (ALL-IN)
13 consecutive wins required
Single loss = restart
```

### Inspiration

Based on traders like ascetic0x who achieved 16+ consecutive wins on Polymarket BTC markets.

---

## Strategy

### ICT Concepts Implemented

1. **Market Structure Analysis**
   - Swing High/Low identification
   - Break of Structure (BOS)
   - Change of Character (CHoCH)
   - Higher Timeframe Bias alignment

2. **Liquidity Logic (MANDATORY)**
   - Equal Highs/Lows detection
   - Session liquidity pools
   - Liquidity sweep confirmation
   - Stop hunt identification

3. **Fair Value Gaps (FVG)**
   - Imbalance detection
   - Displacement confirmation
   - Unfilled gap tracking

4. **MMXM - Market Maker Model**
   - Accumulation phase detection
   - Manipulation (Judas swing)
   - Distribution confirmation

5. **SMT Divergence**
   - BTC vs ETH correlation
   - Divergence at swing points

6. **Killzone Timing**
   - London (07:00-10:00 UTC)
   - New York AM (13:00-16:00 UTC)
   - Silver Bullet windows

---

## Installation

```bash
# Clone the repository
git clone https://github.com/nbk265117/botcasino13.git
cd botcasino13

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Polymarket wallet private key
```

---

## Usage

### Run Single Analysis

```bash
npm start
# or
node src/index.js
```

### Run Continuous Monitoring

```bash
node src/index.js run
```

### Run Backtest

```bash
npm run backtest
# or
node src/backtest/runner.js 2024-01-01 2024-12-31
```

---

## Trade Decision Logic

```
START
  │
  ├─► Is trading day? (not weekend/holiday)
  │     NO → NO TRADE
  │
  ├─► News blackout? (FOMC, CPI, NFP within 60min)
  │     YES → NO TRADE
  │
  ├─► In killzone? (London or NY AM)
  │     NO → NO TRADE
  │
  ├─► Volatility OK? (0.5% < ATR < 3%)
  │     NO → NO TRADE
  │
  ├─► HTF bias aligned? (4H, Daily agree)
  │     NO/NEUTRAL → NO TRADE
  │
  ├─► Liquidity swept? (MANDATORY)
  │     NO → NO TRADE
  │
  ├─► Valid entry model? (FVG, MMXM, or Judas)
  │     NO → NO TRADE
  │
  ├─► Confluence score ≥ 7/10?
  │     NO → NO TRADE
  │
  └─► EXECUTE: LONG or SHORT
```

---

## Project Structure

```
botcasino13/
├── config/
│   └── settings.js          # All configuration parameters
├── src/
│   ├── ict/
│   │   ├── marketStructure.js   # Swing/BOS/CHoCH analysis
│   │   ├── fairValueGap.js      # FVG detection
│   │   ├── liquidity.js         # Liquidity pool analysis
│   │   ├── smtDivergence.js     # BTC/ETH divergence
│   │   ├── mmxm.js              # Market Maker Model
│   │   └── killzones.js         # Time window detection
│   ├── polymarket/
│   │   └── client.js            # Polymarket API integration
│   ├── data/
│   │   └── priceData.js         # Exchange data fetching
│   ├── filters/
│   │   └── newsFilter.js        # Economic calendar filter
│   ├── backtest/
│   │   └── runner.js            # Historical backtesting
│   ├── tradeDecision.js         # Main decision engine
│   └── index.js                 # Entry point
├── PROBABILITY_ANALYSIS.md      # Honest probability assessment
└── package.json
```

---

## Configuration

Key settings in `config/settings.js`:

```javascript
CHALLENGE: {
  STARTING_CAPITAL: 12,
  TARGET_CAPITAL: 98304,
  REQUIRED_WINS: 13,
  POSITION_SIZE_PERCENT: 100,  // ALL-IN
}

CONFLUENCE: {
  MIN_SCORE_TO_TRADE: 7,       // Out of 10
  A_PLUS_SCORE: 9,             // For second daily trade
}

FILTERS: {
  NEWS: {
    BLACKOUT_MINUTES_BEFORE: 60,
    BLACKOUT_MINUTES_AFTER: 30,
  }
}
```

---

## Win Rate Estimates

| Entry Model | Est. Win Rate | Notes |
|------------|---------------|-------|
| MMXM       | 68-72%        | Full market maker cycle |
| FVG + Displacement | 65-68% | After liquidity sweep |
| Judas Swing | 62-65%       | Session open reversal |
| + SMT Divergence | +3-5%   | Confluence bonus |

---

## Probability Reality

```
At 65% win rate:
  P(13 consecutive wins) = 0.17%
  Expected attempts: 585
  Expected cost: $7,020

At 70% win rate:
  P(13 consecutive wins) = 0.37%
  Expected attempts: 272
  Expected cost: $3,264
```

**See [PROBABILITY_ANALYSIS.md](./PROBABILITY_ANALYSIS.md) for full breakdown.**

---

## Limitations

1. **Polymarket SDK**: Full execution requires additional Polymarket/py-clob integration
2. **Paper Trading Mode**: Currently runs in analysis/simulation mode
3. **No Guarantees**: ICT concepts don't guarantee profits
4. **API Rate Limits**: Exchange data subject to rate limiting

---

## Disclaimer

This software is for educational purposes only. Trading cryptocurrency derivatives carries extreme risk. The probability of completing the 13-win challenge is approximately 0.1-0.4% per attempt.

**You will likely lose your money.**

Past performance (like ascetic0x) does not predict future results. Survivorship bias is real.

---

## License

MIT

---

## Contributing

This is an experimental project. Contributions welcome for:
- Polymarket SDK integration
- Additional ICT concepts
- Improved backtesting
- Better news data sources
