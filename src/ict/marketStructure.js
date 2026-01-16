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
   * Identify swing points in price data
   * A swing high = high greater than N candles on each side
   * A swing low = low less than N candles on each side
   */
  identifySwings(candles, lookback = this.swingLookback) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];

      // Check for swing high
      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= current.high || candles[i + j].high >= current.high) {
          isSwingHigh = false;
        }
        if (candles[i - j].low <= current.low || candles[i + j].low <= current.low) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          price: current.high,
          timestamp: current.timestamp,
          candle: current
        });
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          price: current.low,
          timestamp: current.timestamp,
          candle: current
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
   * Detect Break of Structure (BOS)
   * BOS = price breaks previous swing in direction of trend (continuation)
   */
  detectBOS(candles) {
    const { swingHighs, swingLows } = this.identifySwings(candles);
    const recentCandles = candles.slice(-10);

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
   * Detect Change of Character (CHoCH)
   * CHoCH = first break against the trend (potential reversal)
   * In uptrend: first lower low
   * In downtrend: first higher high
   */
  detectCHoCH(candles) {
    const bias = this.determineBias(candles.slice(0, -20)); // Use older data for established trend
    const { swingHighs, swingLows } = this.identifySwings(candles);

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
   */
  getHTFBiasAlignment(timeframeData) {
    const biases = {};
    let bullishCount = 0;
    let bearishCount = 0;

    for (const [tf, candles] of Object.entries(timeframeData)) {
      const analysis = this.determineBias(candles);
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
   * Calculate premium/discount zones
   */
  getPremiumDiscountZone(candles, lookback = 50) {
    const recentCandles = candles.slice(-lookback);

    const high = Math.max(...recentCandles.map(c => c.high));
    const low = Math.min(...recentCandles.map(c => c.low));
    const range = high - low;

    const currentPrice = candles[candles.length - 1].close;
    const position = (currentPrice - low) / range;

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
