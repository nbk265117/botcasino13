/**
 * ICT Liquidity Analysis
 *
 * Core ICT Concept: Smart money hunts liquidity (stop losses)
 *
 * Types of liquidity:
 * 1. Equal Highs/Lows - Obvious stop loss clusters
 * 2. Session Highs/Lows - Previous session extremes
 * 3. Swing Points - Major swing high/low stops
 * 4. Round Numbers - Psychological levels
 */

import { CONFIG } from '../../config/settings.js';

export class LiquidityAnalysis {
  constructor() {
    this.config = CONFIG.ICT.LIQUIDITY;
  }

  /**
   * Find equal highs (buy-side liquidity) - BIAS-FREE VERSION
   * Equal highs = stop losses from shorts sitting above
   *
   * CRITICAL FIX: Exclude the current (last) candle because its high
   * is not yet finalized at decision time.
   *
   * @param {Array} candles - Price candles
   * @param {boolean} onlineMode - If true, exclude current candle (default: true)
   */
  findEqualHighs(candles, onlineMode = true) {
    const equalHighs = [];
    const tolerance = this.config.EQUAL_HIGHS_LOWS_TOLERANCE / 100;
    const minTouches = this.config.MIN_LIQUIDITY_POOL_TOUCHES;

    // BIAS FIX: Exclude current candle in online mode
    const maxIndex = onlineMode ? candles.length - 1 : candles.length;

    // Group highs that are within tolerance
    const highGroups = [];

    for (let i = 0; i < maxIndex; i++) {
      const high = candles[i].high;
      let foundGroup = false;

      for (const group of highGroups) {
        const avgHigh = group.reduce((sum, h) => sum + h.price, 0) / group.length;
        if (Math.abs(high - avgHigh) / avgHigh <= tolerance) {
          group.push({ index: i, price: high, timestamp: candles[i].timestamp });
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        highGroups.push([{ index: i, price: high, timestamp: candles[i].timestamp }]);
      }
    }

    // Filter groups with enough touches
    for (const group of highGroups) {
      if (group.length >= minTouches) {
        const avgPrice = group.reduce((sum, h) => sum + h.price, 0) / group.length;
        equalHighs.push({
          type: 'EQUAL_HIGHS',
          liquidityType: 'BUY_SIDE',
          price: avgPrice,
          touches: group.length,
          touchPoints: group,
          firstTouch: group[0].timestamp,
          lastTouch: group[group.length - 1].timestamp,
          strength: group.length * 10  // More touches = more liquidity
        });
      }
    }

    return equalHighs.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Find equal lows (sell-side liquidity) - BIAS-FREE VERSION
   * Equal lows = stop losses from longs sitting below
   *
   * CRITICAL FIX: Exclude the current (last) candle because its low
   * is not yet finalized at decision time.
   *
   * @param {Array} candles - Price candles
   * @param {boolean} onlineMode - If true, exclude current candle (default: true)
   */
  findEqualLows(candles, onlineMode = true) {
    const equalLows = [];
    const tolerance = this.config.EQUAL_HIGHS_LOWS_TOLERANCE / 100;
    const minTouches = this.config.MIN_LIQUIDITY_POOL_TOUCHES;

    // BIAS FIX: Exclude current candle in online mode
    const maxIndex = onlineMode ? candles.length - 1 : candles.length;

    const lowGroups = [];

    for (let i = 0; i < maxIndex; i++) {
      const low = candles[i].low;
      let foundGroup = false;

      for (const group of lowGroups) {
        const avgLow = group.reduce((sum, l) => sum + l.price, 0) / group.length;
        if (Math.abs(low - avgLow) / avgLow <= tolerance) {
          group.push({ index: i, price: low, timestamp: candles[i].timestamp });
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        lowGroups.push([{ index: i, price: low, timestamp: candles[i].timestamp }]);
      }
    }

    for (const group of lowGroups) {
      if (group.length >= minTouches) {
        const avgPrice = group.reduce((sum, l) => sum + l.price, 0) / group.length;
        equalLows.push({
          type: 'EQUAL_LOWS',
          liquidityType: 'SELL_SIDE',
          price: avgPrice,
          touches: group.length,
          touchPoints: group,
          firstTouch: group[0].timestamp,
          lastTouch: group[group.length - 1].timestamp,
          strength: group.length * 10
        });
      }
    }

    return equalLows.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Identify session highs and lows (major liquidity pools)
   */
  findSessionLiquidity(candles, sessionHours = 24) {
    const candlesPerSession = Math.floor(sessionHours * 12); // Assuming 5m candles
    const sessions = [];

    for (let i = 0; i < candles.length; i += candlesPerSession) {
      const sessionCandles = candles.slice(i, i + candlesPerSession);
      if (sessionCandles.length < candlesPerSession / 2) continue;

      const high = Math.max(...sessionCandles.map(c => c.high));
      const low = Math.min(...sessionCandles.map(c => c.low));

      sessions.push({
        startTime: sessionCandles[0].timestamp,
        endTime: sessionCandles[sessionCandles.length - 1].timestamp,
        high,
        low,
        highIndex: i + sessionCandles.findIndex(c => c.high === high),
        lowIndex: i + sessionCandles.findIndex(c => c.low === low)
      });
    }

    // Return most recent sessions as liquidity targets
    return sessions.slice(-5).map(s => ({
      sessionHigh: {
        type: 'SESSION_HIGH',
        liquidityType: 'BUY_SIDE',
        price: s.high,
        timestamp: s.startTime,
        strength: 30  // Session highs are significant
      },
      sessionLow: {
        type: 'SESSION_LOW',
        liquidityType: 'SELL_SIDE',
        price: s.low,
        timestamp: s.startTime,
        strength: 30
      }
    }));
  }

  /**
   * Detect liquidity sweep (stop hunt) - NO LOOK-AHEAD VERSION
   * This is THE key signal - smart money grabbing liquidity before reversal
   *
   * CRITICAL: A sweep is only "confirmed" when we have enough candles AFTER it.
   * In online mode, we can only detect sweeps that happened at least
   * SWEEP_CONFIRMATION_CANDLES ago.
   *
   * @param {Array} candles - Price candles
   * @param {boolean} onlineMode - If true, only return confirmed sweeps (no look-ahead)
   */
  detectLiquiditySweep(candles, onlineMode = true) {
    const confirmationNeeded = this.config.SWEEP_CONFIRMATION_CANDLES;

    // Find liquidity pools from older data (exclude recent candles)
    // BIAS FIX: Pass onlineMode to child functions
    const equalHighs = this.findEqualHighs(candles.slice(0, -10), onlineMode);
    const equalLows = this.findEqualLows(candles.slice(0, -10), onlineMode);

    const sweeps = [];

    // In online mode, we can only confirm sweeps up to (length - confirmationNeeded - 1)
    // because we need `confirmationNeeded` candles AFTER the sweep
    const maxSweepIndex = onlineMode
      ? candles.length - confirmationNeeded - 1
      : candles.length - 1;

    // Only look at candles that could be sweep candles
    // Start from recent history but leave room for confirmation
    const startIndex = Math.max(0, candles.length - 20);

    // Check for buy-side liquidity sweep (price spiked above equal highs then rejected)
    for (const liqPool of equalHighs) {
      for (let i = startIndex; i <= maxSweepIndex; i++) {
        const sweepCandle = candles[i];

        // Did this candle wick above the liquidity?
        if (sweepCandle.high > liqPool.price) {
          // Check if it rejected (closed below the level)
          const closedBelow = sweepCandle.close < liqPool.price;
          const wickAbove = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);
          const bodySize = Math.abs(sweepCandle.close - sweepCandle.open) || 0.01;

          // Strong rejection = long upper wick, small body, close below level
          if (closedBelow && wickAbove > bodySize * 0.5) {
            // Confirm with subsequent candles (these exist because of maxSweepIndex limit)
            const confirmationCandles = candles.slice(i + 1, i + 1 + confirmationNeeded);

            // Only confirm if we have enough candles
            if (confirmationCandles.length >= confirmationNeeded) {
              const confirmed = confirmationCandles.every(c => c.close < liqPool.price);

              if (confirmed) {
                sweeps.push({
                  type: 'BUY_SIDE_SWEEP',
                  direction: 'BEARISH',  // Swept buy-side = expect bearish
                  liquidityPool: liqPool,
                  sweepCandle,
                  sweepPrice: sweepCandle.high,
                  confirmationCandles,
                  timestamp: sweepCandle.timestamp,
                  confirmedAt: confirmationCandles[confirmationCandles.length - 1].timestamp,
                  strength: liqPool.strength + (wickAbove / bodySize) * 10,
                  candlesSinceConfirmation: candles.length - 1 - (i + confirmationNeeded)
                });
              }
            }
          }
        }
      }
    }

    // Check for sell-side liquidity sweep (price spiked below equal lows then rejected)
    for (const liqPool of equalLows) {
      for (let i = startIndex; i <= maxSweepIndex; i++) {
        const sweepCandle = candles[i];

        if (sweepCandle.low < liqPool.price) {
          const closedAbove = sweepCandle.close > liqPool.price;
          const wickBelow = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
          const bodySize = Math.abs(sweepCandle.close - sweepCandle.open) || 0.01;

          if (closedAbove && wickBelow > bodySize * 0.5) {
            const confirmationCandles = candles.slice(i + 1, i + 1 + confirmationNeeded);

            if (confirmationCandles.length >= confirmationNeeded) {
              const confirmed = confirmationCandles.every(c => c.close > liqPool.price);

              if (confirmed) {
                sweeps.push({
                  type: 'SELL_SIDE_SWEEP',
                  direction: 'BULLISH',  // Swept sell-side = expect bullish
                  liquidityPool: liqPool,
                  sweepCandle,
                  sweepPrice: sweepCandle.low,
                  confirmationCandles,
                  timestamp: sweepCandle.timestamp,
                  confirmedAt: confirmationCandles[confirmationCandles.length - 1].timestamp,
                  strength: liqPool.strength + (wickBelow / bodySize) * 10,
                  candlesSinceConfirmation: candles.length - 1 - (i + confirmationNeeded)
                });
              }
            }
          }
        }
      }
    }

    return sweeps.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Find nearest liquidity targets (where price is likely to go) - BIAS-FREE VERSION
   *
   * CRITICAL FIX: Use OPEN price of current candle (known at decision time)
   */
  findNearestLiquidityTargets(candles) {
    // BIAS FIX: Use OPEN of current candle instead of CLOSE
    const currentPrice = candles[candles.length - 1].open;
    const equalHighs = this.findEqualHighs(candles, true);
    const equalLows = this.findEqualLows(candles, true);
    const sessions = this.findSessionLiquidity(candles);

    const allLiquidity = [
      ...equalHighs,
      ...equalLows,
      ...sessions.flatMap(s => [s.sessionHigh, s.sessionLow])
    ];

    // Separate into above and below current price
    const above = allLiquidity
      .filter(l => l.price > currentPrice)
      .sort((a, b) => a.price - b.price);

    const below = allLiquidity
      .filter(l => l.price < currentPrice)
      .sort((a, b) => b.price - a.price);

    return {
      nearestAbove: above[0] || null,
      nearestBelow: below[0] || null,
      allAbove: above.slice(0, 3),
      allBelow: below.slice(0, 3),
      currentPrice
    };
  }

  /**
   * Check if liquidity has been swept recently (required for entry)
   */
  hasRecentLiquiditySweep(candles, expectedDirection) {
    const sweeps = this.detectLiquiditySweep(candles);

    if (sweeps.length === 0) {
      return {
        swept: false,
        reason: 'No liquidity sweep detected'
      };
    }

    // Find sweeps matching our expected direction
    const matchingSweeps = sweeps.filter(s => s.direction === expectedDirection);

    if (matchingSweeps.length === 0) {
      return {
        swept: false,
        reason: `Sweep detected but wrong direction (${sweeps[0].direction})`
      };
    }

    // Check if sweep is recent (within last 10 candles)
    const latestSweep = matchingSweeps[0];
    const sweepIndex = candles.findIndex(c => c.timestamp === latestSweep.timestamp);
    const candlesSinceSweep = candles.length - 1 - sweepIndex;

    if (candlesSinceSweep > 10) {
      return {
        swept: false,
        reason: `Sweep too old (${candlesSinceSweep} candles ago)`,
        sweep: latestSweep
      };
    }

    return {
      swept: true,
      sweep: latestSweep,
      candlesSinceSweep
    };
  }
}

export default LiquidityAnalysis;
