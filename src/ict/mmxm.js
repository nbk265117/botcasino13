/**
 * ICT MMXM - Market Maker Model (AMD Model)
 *
 * The full cycle of how market makers operate:
 *
 * 1. ACCUMULATION - Smart money quietly builds positions
 * 2. MANIPULATION - Fake move to trap retail (Judas swing / stop hunt)
 * 3. DISTRIBUTION - The real move in intended direction
 * 4. REVERSION - Return to fair value
 *
 * Identifying the manipulation phase and entering on distribution
 * is the highest probability ICT setup.
 */

import { CONFIG } from '../../config/settings.js';
import { MarketStructure } from './marketStructure.js';
import { LiquidityAnalysis } from './liquidity.js';
import { FairValueGap } from './fairValueGap.js';

export class MMXM {
  constructor() {
    this.config = CONFIG.ICT.MMXM;
    this.marketStructure = new MarketStructure();
    this.liquidity = new LiquidityAnalysis();
    this.fvg = new FairValueGap();
  }

  /**
   * Detect accumulation phase
   * Characterized by: tight range, decreasing volatility, equal highs/lows forming
   */
  detectAccumulation(candles) {
    const recentCandles = candles.slice(-30);

    // Calculate range compression
    const ranges = recentCandles.map(c => c.high - c.low);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const recentAvgRange = ranges.slice(-10).reduce((a, b) => a + b, 0) / 10;

    const rangeCompression = recentAvgRange < avgRange * 0.7;

    // Check for equal highs/lows forming (liquidity building)
    const equalHighs = this.liquidity.findEqualHighs(recentCandles);
    const equalLows = this.liquidity.findEqualLows(recentCandles);

    const hasLiquidityBuildup = equalHighs.length > 0 || equalLows.length > 0;

    // Check for sideways structure
    const high = Math.max(...recentCandles.map(c => c.high));
    const low = Math.min(...recentCandles.map(c => c.low));
    const rangePercent = ((high - low) / low) * 100;

    const isSideways = rangePercent < 2; // Less than 2% range

    return {
      detected: rangeCompression && hasLiquidityBuildup,
      characteristics: {
        rangeCompression,
        hasLiquidityBuildup,
        isSideways,
        rangePercent,
        equalHighs: equalHighs.length,
        equalLows: equalLows.length
      },
      liquidityAbove: equalHighs[0]?.price,
      liquidityBelow: equalLows[0]?.price
    };
  }

  /**
   * Detect manipulation phase (Judas swing / stop hunt)
   * Characterized by: quick move into liquidity, immediate rejection
   */
  detectManipulation(candles) {
    const sweeps = this.liquidity.detectLiquiditySweep(candles);

    if (sweeps.length === 0) {
      return { detected: false, reason: 'No liquidity sweep detected' };
    }

    const latestSweep = sweeps[0];

    // Calculate manipulation size
    const sweepCandle = latestSweep.sweepCandle;
    const manipulationMove = latestSweep.type === 'BUY_SIDE_SWEEP'
      ? ((sweepCandle.high - sweepCandle.open) / sweepCandle.open) * 100
      : ((sweepCandle.open - sweepCandle.low) / sweepCandle.open) * 100;

    const significantManipulation = manipulationMove >= this.config.MIN_MANIPULATION_PERCENT;

    // Check for rejection (wick vs body ratio)
    const bodySize = Math.abs(sweepCandle.close - sweepCandle.open);
    const totalSize = sweepCandle.high - sweepCandle.low;
    const wickRatio = (totalSize - bodySize) / totalSize;

    const hasStrongRejection = wickRatio > 0.5; // RELAXED: 50%+ wick = strong rejection (was 60%)

    return {
      detected: significantManipulation && hasStrongRejection,
      sweep: latestSweep,
      manipulationPercent: manipulationMove,
      wickRatio,
      expectedDistributionDirection: latestSweep.direction,
      reason: significantManipulation && hasStrongRejection
        ? 'Manipulation phase confirmed'
        : `Weak manipulation (move: ${manipulationMove.toFixed(2)}%, wick: ${(wickRatio * 100).toFixed(0)}%)`
    };
  }

  /**
   * Detect distribution phase (the real move)
   * Characterized by: FVG formation, strong displacement, break of structure
   */
  detectDistribution(candles, expectedDirection) {
    const recentCandles = candles.slice(-15);

    // Look for FVG in expected direction
    const fvgs = this.fvg.detectFVGs(recentCandles);
    const relevantFvgs = expectedDirection === 'BULLISH' ? fvgs.bullish : fvgs.bearish;

    // Look for break of structure
    const bos = this.marketStructure.detectBOS(candles);
    const relevantBos = bos.filter(b =>
      (expectedDirection === 'BULLISH' && b.type === 'BULLISH_BOS') ||
      (expectedDirection === 'BEARISH' && b.type === 'BEARISH_BOS')
    );

    // Check for displacement (strong momentum candles)
    const displacementCandles = recentCandles.filter(c => {
      const movePercent = Math.abs(c.close - c.open) / c.open * 100;
      const isDirectional = expectedDirection === 'BULLISH'
        ? c.close > c.open
        : c.close < c.open;
      return movePercent >= CONFIG.ICT.FVG.DISPLACEMENT_MIN_SIZE && isDirectional;
    });

    const hasDistribution = relevantFvgs.length > 0 && displacementCandles.length > 0;

    return {
      detected: hasDistribution,
      fvgs: relevantFvgs,
      bosSignals: relevantBos,
      displacementCandles: displacementCandles.length,
      direction: expectedDirection
    };
  }

  /**
   * Full MMXM cycle analysis
   * Returns current phase and trading recommendation
   */
  analyzeMMXMCycle(candles, htfBias) {
    // Phase 1: Check accumulation
    const accumulation = this.detectAccumulation(candles.slice(0, -20));

    // Phase 2: Check manipulation
    const manipulation = this.detectManipulation(candles);

    // Determine expected distribution direction based on manipulation
    const expectedDirection = manipulation.detected
      ? manipulation.expectedDistributionDirection
      : htfBias;

    // Phase 3: Check distribution
    const distribution = manipulation.detected
      ? this.detectDistribution(candles, expectedDirection)
      : { detected: false };

    // Determine current phase
    let currentPhase;
    let tradeable = false;
    let confidence = 0;

    if (distribution.detected) {
      currentPhase = 'DISTRIBUTION';
      tradeable = true;
      confidence = 0.72; // MMXM has high win rate
    } else if (manipulation.detected) {
      currentPhase = 'MANIPULATION_COMPLETE';
      // Can enter here anticipating distribution
      tradeable = true;
      confidence = 0.68;
    } else if (accumulation.detected) {
      currentPhase = 'ACCUMULATION';
      tradeable = false; // Wait for manipulation
      confidence = 0.3;
    } else {
      currentPhase = 'UNKNOWN';
      tradeable = false;
      confidence = 0;
    }

    return {
      currentPhase,
      phases: {
        accumulation,
        manipulation,
        distribution
      },
      tradeable,
      confidence,
      direction: expectedDirection,
      entryReason: tradeable
        ? `MMXM ${currentPhase}: ${manipulation.detected ? 'Liquidity swept' : ''} ${distribution.detected ? 'Distribution started' : ''}`
        : `Waiting for manipulation/distribution`
    };
  }

  /**
   * Judas Swing Detection (specific manipulation pattern at session open)
   */
  detectJudasSwing(candles, sessionOpenIndex, htfBias) {
    if (sessionOpenIndex < 0 || sessionOpenIndex >= candles.length - 5) {
      return { detected: false, reason: 'Invalid session open index' };
    }

    const sessionOpenPrice = candles[sessionOpenIndex].open;
    const postOpenCandles = candles.slice(sessionOpenIndex, sessionOpenIndex + 10);

    // Judas swing = initial move AGAINST the HTF bias
    const initialMove = postOpenCandles.slice(0, 3);
    const initialDirection = initialMove[initialMove.length - 1].close > sessionOpenPrice
      ? 'BULLISH'
      : 'BEARISH';

    // Is initial move against HTF bias? (This is the "Judas" fake-out)
    const isJudasMove = initialDirection !== htfBias;

    if (!isJudasMove) {
      return {
        detected: false,
        reason: `Initial move aligned with HTF bias (not a Judas swing)`
      };
    }

    // Calculate Judas move size
    const judasExtreme = initialDirection === 'BULLISH'
      ? Math.max(...initialMove.map(c => c.high))
      : Math.min(...initialMove.map(c => c.low));

    const judasMovePercent = Math.abs(judasExtreme - sessionOpenPrice) / sessionOpenPrice * 100;

    // Check for reversal after Judas move
    const postJudasCandles = postOpenCandles.slice(3);
    const reversalDetected = postJudasCandles.some(c => {
      if (htfBias === 'BULLISH') {
        return c.close > judasExtreme;
      } else {
        return c.close < judasExtreme;
      }
    });

    // Check if Judas move hit liquidity
    const liquiditySweep = this.liquidity.detectLiquiditySweep(
      candles.slice(0, sessionOpenIndex + 5)
    );

    const hitLiquidity = liquiditySweep.some(s =>
      s.timestamp >= candles[sessionOpenIndex].timestamp
    );

    return {
      detected: isJudasMove && judasMovePercent >= 0.2,
      judasDirection: initialDirection,
      expectedReversal: htfBias,
      judasMovePercent,
      hitLiquidity,
      reversalStarted: reversalDetected,
      sessionOpenPrice,
      judasExtreme,
      tradeable: isJudasMove && hitLiquidity && reversalDetected
    };
  }
}

export default MMXM;
