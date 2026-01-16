/**
 * ICT Market Structure Analysis
 *
 * Identifies:
 * - Swing Highs/Lows
 * - Break of Structure (BOS)
 * - Change of Character (CHoCH)
 * - Higher Timeframe Bias
 */

import { CONFIG } from '../../config/settings.js';

export class MarketStructure {
  constructor() {
    this.swingLookback = CONFIG.ICT.STRUCTURE.SWING_LOOKBACK;
  }

  /**
   * Identify swing points in price data (ONLINE VERSION - NO LOOK-AHEAD)
   * A swing high = high greater than N candles on each side
   * A swing low = low less than N candles on each side
   *
   * CRITICAL: In live trading, we can only CONFIRM a swing after `lookback`
   * candles have passed. This version only returns CONFIRMED swings.
   *
   * @param {Array} candles - Price candles
   * @param {number} lookback - Candles on each side to confirm swing
   * @param {boolean} onlineMode - If true, only return confirmed swings (no look-ahead)
   */
  identifySwings(candles, lookback = this.swingLookback, onlineMode = true) {
    const swingHighs = [];
    const swingLows = [];

    // In online mode, we can only confirm swings up to (length - lookback - 1)
    // because we need `lookback` candles AFTER the swing to confirm it
    const maxIndex = onlineMode
      ? candles.length - lookback - 1  // Can't confirm recent swings yet
      : candles.length - lookback;      // Backtest mode (original behavior)

    for (let i = lookback; i < maxIndex; i++) {
      const current = candles[i];

      // Check for swing high - only look at PAST candles in online mode
      let isSwingHigh = true;
      let isSwingLow = true;

      // Check left side (past) - always safe
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= current.high) {
          isSwingHigh = false;
        }
        if (candles[i - j].low <= current.low) {
          isSwingLow = false;
        }
      }

      // Check right side (future relative to swing point)
      // In online mode, these candles exist because we limited maxIndex
      if (isSwingHigh || isSwingLow) {
        for (let j = 1; j <= lookback; j++) {
          if (i + j < candles.length) {
            if (candles[i + j].high >= current.high) {
              isSwingHigh = false;
            }
            if (candles[i + j].low <= current.low) {
              isSwingLow = false;
            }
          }
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          price: current.high,
          timestamp: current.timestamp,
          candle: current,
          confirmedAt: candles[Math.min(i + lookback, candles.length - 1)].timestamp
        });
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          price: current.low,
          timestamp: current.timestamp,
          candle: current,
          confirmedAt: candles[Math.min(i + lookback, candles.length - 1)].timestamp
        });
      }
    }

    return { swingHighs, swingLows };
  }

  /**
   * Determine market structure bias
   * BULLISH: Higher Highs + Higher Lows
   * BEARISH: Lower Highs + Lower Lows
   */
  determineBias(candles) {
    const { swingHighs, swingLows } = this.identifySwings(candles);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { bias: 'NEUTRAL', confidence: 0, reason: 'Insufficient swings' };
    }

    // Get last 3-4 swings for analysis
    const recentHighs = swingHighs.slice(-4);
    const recentLows = swingLows.slice(-4);

    // Count higher highs/lows vs lower highs/lows
    let higherHighs = 0;
    let lowerHighs = 0;
    let higherLows = 0;
    let lowerLows = 0;

    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i].price > recentHighs[i - 1].price) higherHighs++;
      else lowerHighs++;
    }

    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i].price > recentLows[i - 1].price) higherLows++;
      else lowerLows++;
    }

    // Determine bias
    const bullishScore = higherHighs + higherLows;
    const bearishScore = lowerHighs + lowerLows;

    if (bullishScore > bearishScore + 1) {
      return {
        bias: 'BULLISH',
        confidence: bullishScore / (bullishScore + bearishScore),
        reason: `HH: ${higherHighs}, HL: ${higherLows}`,
        lastSwingHigh: recentHighs[recentHighs.length - 1],
        lastSwingLow: recentLows[recentLows.length - 1]
      };
    } else if (bearishScore > bullishScore + 1) {
      return {
        bias: 'BEARISH',
        confidence: bearishScore / (bullishScore + bearishScore),
        reason: `LH: ${lowerHighs}, LL: ${lowerLows}`,
        lastSwingHigh: recentHighs[recentHighs.length - 1],
        lastSwingLow: recentLows[recentLows.length - 1]
      };
    }

    return {
      bias: 'NEUTRAL',
      confidence: 0.5,
      reason: 'No clear structure',
      lastSwingHigh: recentHighs[recentHighs.length - 1],
      lastSwingLow: recentLows[recentLows.length - 1]
    };
  }

  /**
   * Detect Break of Structure (BOS) - BIAS-FREE VERSION
   * BOS = price breaks previous swing in direction of trend (continuation)
   *
   * CRITICAL FIX: Exclude current candle from break detection because
   * we don't know its final high/low at decision time.
   */
  detectBOS(candles) {
    const { swingHighs, swingLows } = this.identifySwings(candles, this.swingLookback, true);
    // BIAS FIX: Exclude current candle (-1) from recent check
    const recentCandles = candles.slice(-11, -1);

    const bosSignals = [];

    // Check for bullish BOS (break above swing high)
    if (swingHighs.length >= 2) {
      const lastSwingHigh = swingHighs[swingHighs.length - 1];
      const prevSwingHigh = swingHighs[swingHighs.length - 2];

      for (const candle of recentCandles) {
        if (candle.close > lastSwingHigh.price && candle.timestamp > lastSwingHigh.timestamp) {
          bosSignals.push({
            type: 'BULLISH_BOS',
            level: lastSwingHigh.price,
            breakCandle: candle,
            strength: (candle.close - lastSwingHigh.price) / lastSwingHigh.price
          });
          break;
        }
      }
    }

    // Check for bearish BOS (break below swing low)
    if (swingLows.length >= 2) {
      const lastSwingLow = swingLows[swingLows.length - 1];

      for (const candle of recentCandles) {
        if (candle.close < lastSwingLow.price && candle.timestamp > lastSwingLow.timestamp) {
          bosSignals.push({
            type: 'BEARISH_BOS',
            level: lastSwingLow.price,
            breakCandle: candle,
            strength: (lastSwingLow.price - candle.close) / lastSwingLow.price
          });
          break;
        }
      }
    }

    return bosSignals;
  }

  /**
   * Detect Change of Character (CHoCH) - BIAS-FREE VERSION
   * CHoCH = first break against the trend (potential reversal)
   * In uptrend: first lower low
   * In downtrend: first higher high
   *
   * CRITICAL FIX: Use online mode for swing detection.
   */
  detectCHoCH(candles) {
    const bias = this.determineBias(candles.slice(0, -20)); // Use older data for established trend
    // BIAS FIX: Use online mode for swing detection
    const { swingHighs, swingLows } = this.identifySwings(candles, this.swingLookback, true);

    if (bias.bias === 'NEUTRAL') return null;

    if (bias.bias === 'BULLISH' && swingLows.length >= 2) {
      // In uptrend, look for lower low
      const lastLow = swingLows[swingLows.length - 1];
      const prevLow = swingLows[swingLows.length - 2];

      if (lastLow.price < prevLow.price) {
        return {
          type: 'BEARISH_CHOCH',
          previousBias: 'BULLISH',
          level: prevLow.price,
          breakLevel: lastLow.price,
          timestamp: lastLow.timestamp,
          strength: (prevLow.price - lastLow.price) / prevLow.price
        };
      }
    }

    if (bias.bias === 'BEARISH' && swingHighs.length >= 2) {
      // In downtrend, look for higher high
      const lastHigh = swingHighs[swingHighs.length - 1];
      const prevHigh = swingHighs[swingHighs.length - 2];

      if (lastHigh.price > prevHigh.price) {
        return {
          type: 'BULLISH_CHOCH',
          previousBias: 'BEARISH',
          level: prevHigh.price,
          breakLevel: lastHigh.price,
          timestamp: lastHigh.timestamp,
          strength: (lastHigh.price - prevHigh.price) / prevHigh.price
        };
      }
    }

    return null;
  }

  /**
   * Get multi-timeframe bias alignment
   * Uses appropriate lookback for each timeframe
   */
  getHTFBiasAlignment(timeframeData) {
    const biases = {};
    let bullishCount = 0;
    let bearishCount = 0;

    // HTF timeframes need smaller lookback (fewer candles available)
    const htfTimeframes = ['4h', '1d', '1w'];
    const htfLookback = CONFIG.ICT.STRUCTURE.SWING_LOOKBACK_HTF || 3;

    for (const [tf, candles] of Object.entries(timeframeData)) {
      // Use smaller lookback for HTF
      const isHTF = htfTimeframes.includes(tf);
      const lookback = isHTF ? htfLookback : this.swingLookback;

      const analysis = this.determineBiasWithLookback(candles, lookback);
      biases[tf] = analysis;

      if (analysis.bias === 'BULLISH') bullishCount++;
      else if (analysis.bias === 'BEARISH') bearishCount++;
    }

    const totalTFs = Object.keys(timeframeData).length;
    const aligned = Math.max(bullishCount, bearishCount) >= CONFIG.HTF_BIAS.MIN_ALIGNED_COUNT;

    return {
      biases,
      overallBias: bullishCount > bearishCount ? 'BULLISH' : bearishCount > bullishCount ? 'BEARISH' : 'NEUTRAL',
      aligned,
      alignment: Math.max(bullishCount, bearishCount) / totalTFs,
      bullishCount,
      bearishCount
    };
  }

  /**
   * Determine bias with specific lookback
   */
  determineBiasWithLookback(candles, lookback) {
    const { swingHighs, swingLows } = this.identifySwings(candles, lookback, true);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { bias: 'NEUTRAL', confidence: 0, reason: `Insufficient swings (H:${swingHighs.length}, L:${swingLows.length})` };
    }

    // Get last 3-4 swings for analysis
    const recentHighs = swingHighs.slice(-4);
    const recentLows = swingLows.slice(-4);

    // Count higher highs/lows vs lower highs/lows
    let higherHighs = 0;
    let lowerHighs = 0;
    let higherLows = 0;
    let lowerLows = 0;

    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i].price > recentHighs[i - 1].price) higherHighs++;
      else lowerHighs++;
    }

    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i].price > recentLows[i - 1].price) higherLows++;
      else lowerLows++;
    }

    // Determine bias
    const bullishScore = higherHighs + higherLows;
    const bearishScore = lowerHighs + lowerLows;

    if (bullishScore > bearishScore) {
      return {
        bias: 'BULLISH',
        confidence: bullishScore / (bullishScore + bearishScore + 0.01),
        reason: `HH:${higherHighs} HL:${higherLows}`,
        lastSwingHigh: recentHighs[recentHighs.length - 1],
        lastSwingLow: recentLows[recentLows.length - 1]
      };
    } else if (bearishScore > bullishScore) {
      return {
        bias: 'BEARISH',
        confidence: bearishScore / (bullishScore + bearishScore + 0.01),
        reason: `LH:${lowerHighs} LL:${lowerLows}`,
        lastSwingHigh: recentHighs[recentHighs.length - 1],
        lastSwingLow: recentLows[recentLows.length - 1]
      };
    }

    return {
      bias: 'NEUTRAL',
      confidence: 0.5,
      reason: 'No clear structure',
      lastSwingHigh: recentHighs[recentHighs.length - 1],
      lastSwingLow: recentLows[recentLows.length - 1]
    };
  }

  /**
   * Calculate premium/discount zones (BIAS-FREE VERSION)
   *
   * CRITICAL FIX: We exclude the CURRENT (last) candle from high/low calculation
   * because at decision time, we don't know its final high/low yet.
   * We only use COMPLETED candles for the range calculation.
   */
  getPremiumDiscountZone(candles, lookback = 50) {
    // BIAS FIX: Exclude the last candle (current/incomplete) from range calculation
    // Use candles from -lookback-1 to -1 (excluding the last one)
    const completedCandles = candles.slice(-(lookback + 1), -1);

    if (completedCandles.length < 10) {
      // Not enough data, return neutral
      return {
        zone: 'NEUTRAL',
        position: 0.5,
        high: 0,
        low: 0,
        equilibrium: 0,
        currentPrice: candles[candles.length - 1]?.close || 0,
        fibLevels: {}
      };
    }

    // Calculate range from COMPLETED candles only
    const high = Math.max(...completedCandles.map(c => c.high));
    const low = Math.min(...completedCandles.map(c => c.low));
    const range = high - low;

    // Use the OPEN of the current candle (known at decision time) instead of close
    const currentPrice = candles[candles.length - 1].open;
    const position = range > 0 ? (currentPrice - low) / range : 0.5;

    const premiumThreshold = CONFIG.ICT.PREMIUM_DISCOUNT.PREMIUM_THRESHOLD;
    const discountThreshold = CONFIG.ICT.PREMIUM_DISCOUNT.DISCOUNT_THRESHOLD;
    const equilibriumBuffer = CONFIG.ICT.PREMIUM_DISCOUNT.EQUILIBRIUM_BUFFER;

    let zone;
    if (position >= premiumThreshold) {
      zone = 'PREMIUM';
    } else if (position <= discountThreshold) {
      zone = 'DISCOUNT';
    } else if (Math.abs(position - 0.5) <= equilibriumBuffer) {
      zone = 'EQUILIBRIUM';
    } else if (position > 0.5) {
      zone = 'PREMIUM_EDGE';
    } else {
      zone = 'DISCOUNT_EDGE';
    }

    return {
      zone,
      position,
      high,
      low,
      equilibrium: (high + low) / 2,
      currentPrice,
      fibLevels: {
        '0.0': low,
        '0.236': low + range * 0.236,
        '0.382': low + range * 0.382,
        '0.5': low + range * 0.5,
        '0.618': low + range * 0.618,
        '0.786': low + range * 0.786,
        '1.0': high
      }
    };
  }
}

export default MarketStructure;
