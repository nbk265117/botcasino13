/**
 * ICT Fair Value Gap (FVG) / Imbalance Detection
 *
 * FVG = Gap between candle 1's low and candle 3's high (bullish)
 *     = Gap between candle 1's high and candle 3's low (bearish)
 *
 * These are institutional footprints - price tends to return to fill them
 */

import { CONFIG } from '../../config/settings.js';

export class FairValueGap {
  constructor() {
    this.config = CONFIG.ICT.FVG;
  }

  /**
   * Detect all Fair Value Gaps in price data
   */
  detectFVGs(candles) {
    const fvgs = {
      bullish: [],
      bearish: []
    };

    for (let i = 2; i < candles.length; i++) {
      const candle1 = candles[i - 2];
      const candle2 = candles[i - 1]; // The displacement candle
      const candle3 = candles[i];

      // Bullish FVG: Gap between candle 1 low and candle 3 high
      // (candle 2 moved up so fast it left a gap)
      if (candle3.low > candle1.high) {
        const gapSize = candle3.low - candle1.high;
        const gapPercent = (gapSize / candle2.close) * 100;

        if (gapPercent >= this.config.MIN_SIZE_PERCENT &&
            gapPercent <= this.config.MAX_SIZE_PERCENT) {

          // Check for displacement (strong move)
          const displacementSize = Math.abs(candle2.close - candle2.open) / candle2.open * 100;
          const hasDisplacement = displacementSize >= this.config.DISPLACEMENT_MIN_SIZE;

          if (!this.config.REQUIRE_DISPLACEMENT || hasDisplacement) {
            fvgs.bullish.push({
              type: 'BULLISH_FVG',
              high: candle3.low,        // Top of gap
              low: candle1.high,        // Bottom of gap
              midpoint: (candle3.low + candle1.high) / 2,
              size: gapSize,
              sizePercent: gapPercent,
              timestamp: candle2.timestamp,
              index: i - 1,
              displacementCandle: candle2,
              hasDisplacement,
              filled: false,
              partiallyFilled: false
            });
          }
        }
      }

      // Bearish FVG: Gap between candle 1 high and candle 3 low
      // (candle 2 moved down so fast it left a gap)
      if (candle1.low > candle3.high) {
        const gapSize = candle1.low - candle3.high;
        const gapPercent = (gapSize / candle2.close) * 100;

        if (gapPercent >= this.config.MIN_SIZE_PERCENT &&
            gapPercent <= this.config.MAX_SIZE_PERCENT) {

          const displacementSize = Math.abs(candle2.close - candle2.open) / candle2.open * 100;
          const hasDisplacement = displacementSize >= this.config.DISPLACEMENT_MIN_SIZE;

          if (!this.config.REQUIRE_DISPLACEMENT || hasDisplacement) {
            fvgs.bearish.push({
              type: 'BEARISH_FVG',
              high: candle1.low,        // Top of gap
              low: candle3.high,        // Bottom of gap
              midpoint: (candle1.low + candle3.high) / 2,
              size: gapSize,
              sizePercent: gapPercent,
              timestamp: candle2.timestamp,
              index: i - 1,
              displacementCandle: candle2,
              hasDisplacement,
              filled: false,
              partiallyFilled: false
            });
          }
        }
      }
    }

    return fvgs;
  }

  /**
   * Find unfilled FVGs that price might return to
   */
  findUnfilledFVGs(candles) {
    const allFvgs = this.detectFVGs(candles.slice(0, -10)); // Exclude recent candles
    const recentCandles = candles.slice(-10);
    const currentPrice = candles[candles.length - 1].close;

    const unfilled = {
      bullish: [],
      bearish: []
    };

    // Check each bullish FVG
    for (const fvg of allFvgs.bullish) {
      let filled = false;
      let partiallyFilled = false;

      // Check if any subsequent candle filled the gap
      for (let i = fvg.index + 1; i < candles.length; i++) {
        const candle = candles[i];
        if (candle.low <= fvg.low) {
          filled = true;
          break;
        }
        if (candle.low <= fvg.midpoint) {
          partiallyFilled = true;
        }
      }

      if (!filled) {
        // Check if price is approaching from above (potential entry)
        const distanceToFVG = ((currentPrice - fvg.high) / currentPrice) * 100;

        unfilled.bullish.push({
          ...fvg,
          filled,
          partiallyFilled,
          distancePercent: distanceToFVG,
          isApproaching: distanceToFVG < 1 && distanceToFVG > -0.5,
          isInside: currentPrice <= fvg.high && currentPrice >= fvg.low
        });
      }
    }

    // Check each bearish FVG
    for (const fvg of allFvgs.bearish) {
      let filled = false;
      let partiallyFilled = false;

      for (let i = fvg.index + 1; i < candles.length; i++) {
        const candle = candles[i];
        if (candle.high >= fvg.high) {
          filled = true;
          break;
        }
        if (candle.high >= fvg.midpoint) {
          partiallyFilled = true;
        }
      }

      if (!filled) {
        const distanceToFVG = ((fvg.low - currentPrice) / currentPrice) * 100;

        unfilled.bearish.push({
          ...fvg,
          filled,
          partiallyFilled,
          distancePercent: distanceToFVG,
          isApproaching: distanceToFVG < 1 && distanceToFVG > -0.5,
          isInside: currentPrice <= fvg.high && currentPrice >= fvg.low
        });
      }
    }

    return unfilled;
  }

  /**
   * Find the most relevant FVG for current trading
   * Prioritizes: Recent, unfilled, price approaching, with displacement
   */
  findBestFVG(candles, bias) {
    const unfilled = this.findUnfilledFVGs(candles);
    const targetFvgs = bias === 'BULLISH' ? unfilled.bullish : unfilled.bearish;

    if (targetFvgs.length === 0) return null;

    // Score each FVG
    const scored = targetFvgs.map(fvg => {
      let score = 0;

      // Recent FVGs are better (more relevant)
      const recency = 1 - (fvg.index / candles.length);
      score += recency * 30;

      // Approaching FVGs are ideal
      if (fvg.isApproaching) score += 40;
      if (fvg.isInside) score += 50;

      // Displacement adds strength
      if (fvg.hasDisplacement) score += 20;

      // Partially filled is less ideal
      if (fvg.partiallyFilled) score -= 10;

      return { ...fvg, score };
    });

    // Return highest scored
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  /**
   * Check if current price is at a valid FVG entry
   */
  isAtFVGEntry(candles, bias) {
    const bestFvg = this.findBestFVG(candles, bias);

    if (!bestFvg) {
      return { valid: false, reason: 'No unfilled FVG found' };
    }

    if (!bestFvg.isApproaching && !bestFvg.isInside) {
      return {
        valid: false,
        reason: `FVG too far: ${bestFvg.distancePercent.toFixed(2)}% away`,
        fvg: bestFvg
      };
    }

    return {
      valid: true,
      fvg: bestFvg,
      entryZone: {
        high: bestFvg.high,
        low: bestFvg.midpoint,  // Enter at midpoint for better entry
        optimal: bestFvg.midpoint
      }
    };
  }
}

export default FairValueGap;
