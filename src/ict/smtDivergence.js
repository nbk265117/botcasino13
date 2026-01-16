/**
 * ICT SMT (Smart Money Technique) Divergence
 *
 * When correlated assets diverge at key levels, it signals institutional activity
 *
 * BTC vs ETH Divergence:
 * - If BTC makes a new high but ETH doesn't = bearish divergence
 * - If BTC makes a new low but ETH doesn't = bullish divergence
 *
 * This is one of the highest probability ICT concepts
 */

import { CONFIG } from '../../config/settings.js';

export class SMTDivergence {
  constructor() {
    this.config = CONFIG.ICT.SMT;
  }

  /**
   * Calculate correlation between two price series
   */
  calculateCorrelation(series1, series2) {
    if (series1.length !== series2.length || series1.length < 2) {
      return 0;
    }

    const n = series1.length;
    const mean1 = series1.reduce((a, b) => a + b, 0) / n;
    const mean2 = series2.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = series1[i] - mean1;
      const diff2 = series2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(denom1 * denom2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Identify swing highs in price data (ONLINE VERSION - NO LOOK-AHEAD)
   *
   * CRITICAL: We can only confirm a swing AFTER `lookback` candles have passed.
   * This prevents look-ahead bias in backtesting.
   *
   * @param {Array} candles - Price candles
   * @param {number} lookback - Candles needed on each side
   * @param {boolean} onlineMode - If true, only return confirmed swings
   */
  findSwingHighs(candles, lookback = 5, onlineMode = true) {
    const swings = [];

    // In online mode, can only confirm swings up to (length - lookback - 1)
    const maxIndex = onlineMode
      ? candles.length - lookback - 1
      : candles.length - lookback;

    for (let i = lookback; i < maxIndex; i++) {
      let isSwingHigh = true;

      // Check left side (past)
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= candles[i].high) {
          isSwingHigh = false;
          break;
        }
      }

      // Check right side (these candles exist because we limited maxIndex)
      if (isSwingHigh) {
        for (let j = 1; j <= lookback; j++) {
          if (i + j < candles.length && candles[i + j].high >= candles[i].high) {
            isSwingHigh = false;
            break;
          }
        }
      }

      if (isSwingHigh) {
        swings.push({
          index: i,
          price: candles[i].high,
          timestamp: candles[i].timestamp,
          confirmedAt: candles[Math.min(i + lookback, candles.length - 1)].timestamp
        });
      }
    }

    return swings;
  }

  /**
   * Identify swing lows in price data (ONLINE VERSION - NO LOOK-AHEAD)
   */
  findSwingLows(candles, lookback = 5, onlineMode = true) {
    const swings = [];

    const maxIndex = onlineMode
      ? candles.length - lookback - 1
      : candles.length - lookback;

    for (let i = lookback; i < maxIndex; i++) {
      let isSwingLow = true;

      // Check left side (past)
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].low <= candles[i].low) {
          isSwingLow = false;
          break;
        }
      }

      // Check right side
      if (isSwingLow) {
        for (let j = 1; j <= lookback; j++) {
          if (i + j < candles.length && candles[i + j].low <= candles[i].low) {
            isSwingLow = false;
            break;
          }
        }
      }

      if (isSwingLow) {
        swings.push({
          index: i,
          price: candles[i].low,
          timestamp: candles[i].timestamp,
          confirmedAt: candles[Math.min(i + lookback, candles.length - 1)].timestamp
        });
      }
    }

    return swings;
  }

  /**
   * Detect SMT Divergence between BTC and ETH
   */
  detectDivergence(btcCandles, ethCandles) {
    if (btcCandles.length !== ethCandles.length) {
      throw new Error('BTC and ETH candle arrays must be same length');
    }

    const lookback = this.config.DIVERGENCE_LOOKBACK;

    // First check correlation - need high correlation for SMT to be valid
    const btcCloses = btcCandles.slice(-50).map(c => c.close);
    const ethCloses = ethCandles.slice(-50).map(c => c.close);
    const correlation = this.calculateCorrelation(btcCloses, ethCloses);

    if (correlation < this.config.CORRELATION_THRESHOLD) {
      return {
        valid: false,
        reason: `Correlation too low: ${correlation.toFixed(3)} < ${this.config.CORRELATION_THRESHOLD}`,
        correlation
      };
    }

    // Find recent swing highs in both
    const btcSwingHighs = this.findSwingHighs(btcCandles.slice(-lookback * 2));
    const ethSwingHighs = this.findSwingHighs(ethCandles.slice(-lookback * 2));

    // Find recent swing lows in both
    const btcSwingLows = this.findSwingLows(btcCandles.slice(-lookback * 2));
    const ethSwingLows = this.findSwingLows(ethCandles.slice(-lookback * 2));

    const divergences = [];

    // Check for bearish SMT (BTC higher high, ETH lower high)
    if (btcSwingHighs.length >= 2 && ethSwingHighs.length >= 2) {
      const btcLatestHigh = btcSwingHighs[btcSwingHighs.length - 1];
      const btcPrevHigh = btcSwingHighs[btcSwingHighs.length - 2];
      const ethLatestHigh = ethSwingHighs[ethSwingHighs.length - 1];
      const ethPrevHigh = ethSwingHighs[ethSwingHighs.length - 2];

      // BTC made higher high
      const btcHigherHigh = btcLatestHigh.price > btcPrevHigh.price;
      // ETH made lower high (divergence)
      const ethLowerHigh = ethLatestHigh.price < ethPrevHigh.price;

      if (btcHigherHigh && ethLowerHigh) {
        const btcMove = ((btcLatestHigh.price - btcPrevHigh.price) / btcPrevHigh.price) * 100;
        const ethMove = ((ethLatestHigh.price - ethPrevHigh.price) / ethPrevHigh.price) * 100;

        if (Math.abs(btcMove - ethMove) >= this.config.MIN_DIVERGENCE_PERCENT) {
          divergences.push({
            type: 'BEARISH_SMT',
            direction: 'BEARISH',
            btcAction: 'HIGHER_HIGH',
            ethAction: 'LOWER_HIGH',
            btcSwings: { latest: btcLatestHigh, previous: btcPrevHigh },
            ethSwings: { latest: ethLatestHigh, previous: ethPrevHigh },
            divergencePercent: Math.abs(btcMove - ethMove),
            timestamp: btcLatestHigh.timestamp,
            strength: Math.abs(btcMove - ethMove) * 10 + (correlation * 20)
          });
        }
      }
    }

    // Check for bullish SMT (BTC lower low, ETH higher low)
    if (btcSwingLows.length >= 2 && ethSwingLows.length >= 2) {
      const btcLatestLow = btcSwingLows[btcSwingLows.length - 1];
      const btcPrevLow = btcSwingLows[btcSwingLows.length - 2];
      const ethLatestLow = ethSwingLows[ethSwingLows.length - 1];
      const ethPrevLow = ethSwingLows[ethSwingLows.length - 2];

      // BTC made lower low
      const btcLowerLow = btcLatestLow.price < btcPrevLow.price;
      // ETH made higher low (divergence)
      const ethHigherLow = ethLatestLow.price > ethPrevLow.price;

      if (btcLowerLow && ethHigherLow) {
        const btcMove = ((btcPrevLow.price - btcLatestLow.price) / btcPrevLow.price) * 100;
        const ethMove = ((ethPrevLow.price - ethLatestLow.price) / ethPrevLow.price) * 100;

        if (Math.abs(btcMove - ethMove) >= this.config.MIN_DIVERGENCE_PERCENT) {
          divergences.push({
            type: 'BULLISH_SMT',
            direction: 'BULLISH',
            btcAction: 'LOWER_LOW',
            ethAction: 'HIGHER_LOW',
            btcSwings: { latest: btcLatestLow, previous: btcPrevLow },
            ethSwings: { latest: ethLatestLow, previous: ethPrevLow },
            divergencePercent: Math.abs(btcMove - ethMove),
            timestamp: btcLatestLow.timestamp,
            strength: Math.abs(btcMove - ethMove) * 10 + (correlation * 20)
          });
        }
      }
    }

    return {
      valid: divergences.length > 0,
      correlation,
      divergences,
      latestDivergence: divergences[divergences.length - 1] || null
    };
  }

  /**
   * Check for SMT confirmation at current price
   */
  checkSMTConfirmation(btcCandles, ethCandles, expectedDirection) {
    const analysis = this.detectDivergence(btcCandles, ethCandles);

    if (!analysis.valid) {
      return {
        confirmed: false,
        reason: analysis.reason || 'No SMT divergence detected',
        correlation: analysis.correlation
      };
    }

    const matchingDivergence = analysis.divergences.find(d => d.direction === expectedDirection);

    if (!matchingDivergence) {
      return {
        confirmed: false,
        reason: `SMT divergence found but wrong direction (${analysis.latestDivergence?.direction})`,
        correlation: analysis.correlation,
        divergences: analysis.divergences
      };
    }

    // Check if divergence is recent (within lookback period)
    const divergenceIndex = btcCandles.findIndex(c => c.timestamp === matchingDivergence.timestamp);
    const candlesSinceDivergence = btcCandles.length - 1 - divergenceIndex;

    if (candlesSinceDivergence > this.config.DIVERGENCE_LOOKBACK) {
      return {
        confirmed: false,
        reason: `SMT divergence too old (${candlesSinceDivergence} candles ago)`,
        divergence: matchingDivergence
      };
    }

    return {
      confirmed: true,
      divergence: matchingDivergence,
      candlesSinceDivergence,
      correlation: analysis.correlation
    };
  }
}

export default SMTDivergence;
