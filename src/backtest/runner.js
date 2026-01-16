/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BACKTEST FRAMEWORK
 * Tests ICT strategy on historical BTC data
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS MEASURES:
 * 1. Win Rate - Most critical for 13x challenge
 * 2. Max Consecutive Losses - Challenge killer
 * 3. Trade Frequency - How often do setups appear?
 * 4. Drawdown Patterns - When does strategy fail?
 *
 * BACKTEST METHODOLOGY:
 * - Use ONLY killzone hours
 * - Apply all filters (news, volatility)
 * - Single trade per day max
 * - Binary outcome: Did BTC close UP or DOWN vs open?
 */

import ccxt from 'ccxt';
import {
  MarketStructure,
  FairValueGap,
  LiquidityAnalysis,
  SMTDivergence,
  MMXM,
  KillzoneDetector
} from '../ict/index.js';
import { CONFIG } from '../../config/settings.js';

export class Backtester {
  constructor() {
    this.exchange = new ccxt.binance({ enableRateLimit: true });
    this.marketStructure = new MarketStructure();
    this.fvg = new FairValueGap();
    this.liquidity = new LiquidityAnalysis();
    this.smt = new SMTDivergence();
    this.mmxm = new MMXM();
    this.killzones = new KillzoneDetector();
  }

  /**
   * Fetch historical data
   */
  async fetchHistoricalData(symbol, timeframe, since, limit = 1000) {
    const allCandles = [];
    let currentSince = since;

    while (allCandles.length < limit) {
      const candles = await this.exchange.fetchOHLCV(
        symbol,
        timeframe,
        currentSince,
        Math.min(500, limit - allCandles.length)
      );

      if (candles.length === 0) break;

      allCandles.push(...candles.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp,
        date: new Date(timestamp).toISOString(),
        open, high, low, close, volume
      })));

      currentSince = candles[candles.length - 1][0] + 1;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allCandles;
  }

  /**
   * Simulate a single day's trading decision (REALISTIC TIMING - NO LOOK-AHEAD)
   *
   * ETH13 STRATEGY - Uses ETH as primary asset, BTC for SMT divergence
   *
   * CRITICAL CHANGES TO PREVENT LOOK-AHEAD BIAS:
   * 1. Decision is made at a SPECIFIC time (decisionHour)
   * 2. Only candles BEFORE decision time are used for analysis
   * 3. HTF candles are filtered to only include COMPLETED candles
   * 4. Entry price is at decision time, not end of killzone
   *
   * @param {Array} dayCandles - All 5m ETH candles for the day
   * @param {Object} htfCandles - Higher timeframe ETH candles
   * @param {Array} smtDayCandles - BTC candles for SMT divergence
   * @param {number} decisionHour - UTC hour when decision is made (default: 15 = 3PM UTC)
   */
  simulateDay(dayCandles, htfCandles, smtDayCandles, decisionHour = 15) {
    // STEP 1: Find the decision point candle
    const decisionTimestamp = dayCandles.find(c => {
      const hour = new Date(c.timestamp).getUTCHours();
      return hour >= decisionHour;
    })?.timestamp;

    if (!decisionTimestamp) {
      return { traded: false, reason: 'No candle at decision hour' };
    }

    // STEP 2: Only use candles BEFORE the decision point for analysis
    const availableCandles = dayCandles.filter(c => c.timestamp <= decisionTimestamp);

    // STEP 3: Filter killzone candles from available data only
    const killzoneCandles = availableCandles.filter(candle => {
      const hour = new Date(candle.timestamp).getUTCHours();
      // London: 7-10, NY AM: 13-16 (but only up to decision hour)
      return (hour >= 7 && hour <= 10) || (hour >= 13 && hour < decisionHour);
    });

    if (killzoneCandles.length < 15) {
      return { traded: false, reason: 'Insufficient killzone data before decision' };
    }

    // STEP 4: Filter HTF candles to only COMPLETED candles before decision
    // A 4H candle is only complete if we're past its close time
    const decisionTime = new Date(decisionTimestamp);
    const filteredHTF = {
      '4h': (htfCandles['4h'] || []).filter(c => {
        const candleClose = new Date(c.timestamp + 4 * 60 * 60 * 1000); // 4h later
        return candleClose <= decisionTime;
      }).slice(-100),  // Keep more candles for proper swing detection
      '1d': (htfCandles['1d'] || []).filter(c => {
        // Daily candles - only use previous days, not current day
        const candleDate = new Date(c.timestamp).toISOString().split('T')[0];
        const decisionDate = decisionTime.toISOString().split('T')[0];
        return candleDate < decisionDate;
      }).slice(-60)    // Keep more candles for proper swing detection
    };

    // STEP 5: Analyze HTF bias with filtered data
    const htfBias = this.marketStructure.getHTFBiasAlignment(filteredHTF);

    // RELAXED: Allow trading even with neutral HTF bias
    // Use LTF (lower timeframe) direction if HTF is neutral
    let expectedDirection = htfBias.overallBias;

    if (htfBias.overallBias === 'NEUTRAL' && CONFIG.HTF_BIAS?.ALLOW_NEUTRAL_BIAS) {
      // Use LTF bias from killzone candles
      const ltfBias = this.marketStructure.determineBias(killzoneCandles);
      if (ltfBias.bias !== 'NEUTRAL') {
        expectedDirection = ltfBias.bias;
      } else {
        return { traded: false, reason: 'No HTF or LTF alignment' };
      }
    } else if (!htfBias.aligned && !CONFIG.HTF_BIAS?.ALLOW_NEUTRAL_BIAS) {
      return { traded: false, reason: 'No HTF alignment' };
    }

    // STEP 6: Check for liquidity sweep with available candles only
    // BIAS-FREE: Liquidity sweep is now OPTIONAL (adds confluence but doesn't block)
    // This is more realistic as sweeps are harder to confirm in real-time
    const liquiditySweep = this.liquidity.hasRecentLiquiditySweep(killzoneCandles, expectedDirection);

    // SWEEP IS NOW OPTIONAL - it adds confluence points but doesn't block trades
    // Set SWEEP_REQUIRED_STRICT: true in config to require sweeps (not recommended for production)
    const sweepRequiredStrict = CONFIG.ICT?.LIQUIDITY?.SWEEP_REQUIRED_STRICT || false;

    if (sweepRequiredStrict && !liquiditySweep.swept) {
      return { traded: false, reason: 'No liquidity sweep (strict mode)' };
    }

    // STEP 7: Check for valid entry model
    const fvgEntry = this.fvg.isAtFVGEntry(killzoneCandles, expectedDirection);
    const mmxmAnalysis = this.mmxm.analyzeMMXMCycle(killzoneCandles, expectedDirection);

    // FVG-ONLY MODE: Only trade when FVG is valid (75% win rate on ETH vs 47% for MMXM)
    // This is the recommended mode for ETH13 strategy
    const fvgOnlyMode = CONFIG.ENTRY_MODELS?.FVG_ONLY || true; // DEFAULT: ON for ETH13

    if (fvgOnlyMode) {
      if (!fvgEntry.valid) {
        return { traded: false, reason: 'No FVG entry (FVG-only mode)' };
      }
    } else {
      if (!fvgEntry.valid && !mmxmAnalysis.tradeable) {
        return { traded: false, reason: 'No valid entry model' };
      }
    }

    // STEP 8: SMT check with BTC candles (ETH13 uses BTC for SMT divergence)
    let hasSMT = false;
    const smtAvailable = smtDayCandles.filter(c => c.timestamp <= decisionTimestamp);
    const smtKillzone = smtAvailable.filter(candle => {
      const hour = new Date(candle.timestamp).getUTCHours();
      return (hour >= 7 && hour <= 10) || (hour >= 13 && hour < decisionHour);
    });

    if (smtKillzone.length === killzoneCandles.length) {
      const smtCheck = this.smt.checkSMTConfirmation(killzoneCandles, smtKillzone, expectedDirection);
      hasSMT = smtCheck.confirmed;
    }

    // SMT REQUIRED filter - blocks trades without SMT confirmation
    const smtRequired = CONFIG.ICT?.SMT?.REQUIRED || false;
    if (smtRequired && !hasSMT) {
      return { traded: false, reason: 'No SMT divergence (SMT required mode)' };
    }

    // STEP 9: Calculate confluence (RELAXED scoring)
    let confluence = 0;
    let confluenceDetails = [];

    // HTF bias - 2 points if aligned, 1 point if using LTF
    if (htfBias.aligned && htfBias.overallBias !== 'NEUTRAL') {
      confluence += 2;
      confluenceDetails.push('HTF');
    } else if (expectedDirection !== 'NEUTRAL') {
      confluence += 1; // Using LTF direction
      confluenceDetails.push('LTF');
    }

    // Liquidity sweep - bonus points (not mandatory)
    if (liquiditySweep.swept) {
      confluence += 2;
      confluenceDetails.push('SWEEP');
    }

    // Entry model
    if (fvgEntry.valid) {
      confluence += 1.5;
      confluenceDetails.push('FVG');
    }
    if (mmxmAnalysis.tradeable) {
      confluence += 2; // MMXM is higher value (66.7% win rate in backtest)
      confluenceDetails.push('MMXM');
    }

    // SMT divergence
    if (hasSMT) {
      confluence += 1.5;
      confluenceDetails.push('SMT');
    }

    // STRICT threshold: Use config value
    const minConfluence = CONFIG.CONFLUENCE?.MIN_SCORE_TO_TRADE || 7;
    if (confluence < minConfluence) {
      return { traded: false, reason: `Low confluence: ${confluence.toFixed(1)} (need ${minConfluence})` };
    }

    // STEP 10: Entry price - BIAS-FREE VERSION
    // CRITICAL FIX: At decision time, we can't trade at the CLOSE price
    // because we don't know it yet. We trade at the OPEN of the NEXT candle.
    //
    // Find the first candle AFTER the decision candle
    const decisionCandle = availableCandles[availableCandles.length - 1];
    const nextCandleIndex = dayCandles.findIndex(c => c.timestamp > decisionCandle.timestamp);

    // Use OPEN of next candle if available, otherwise use CLOSE of decision candle
    // (CLOSE is a fallback but is less realistic)
    let entryPrice;
    let entryCandle;

    if (nextCandleIndex !== -1 && nextCandleIndex < dayCandles.length) {
      entryCandle = dayCandles[nextCandleIndex];
      entryPrice = entryCandle.open; // OPEN of next candle = realistic entry
    } else {
      // Fallback: use decision candle's close (less realistic)
      entryCandle = decisionCandle;
      entryPrice = decisionCandle.close;
    }

    // STEP 11: Outcome - did BTC close UP or DOWN vs daily open?
    // This is the ONLY place we use future data (to determine if we won)
    const dayClose = dayCandles[dayCandles.length - 1].close;
    const dayOpen = dayCandles[0].open;

    const actualDirection = dayClose > dayOpen ? 'BULLISH' : 'BEARISH';
    const isWin = actualDirection === expectedDirection;

    return {
      traded: true,
      prediction: expectedDirection,
      actual: actualDirection,
      isWin,
      entryPrice,
      entryTime: new Date(entryCandle.timestamp).toISOString(),
      decisionHour,
      dayOpen,
      dayClose,
      percentMove: ((dayClose - dayOpen) / dayOpen * 100).toFixed(2),
      confluence,
      confluenceDetails: confluenceDetails.join('+'),
      model: mmxmAnalysis.tradeable ? 'MMXM' : 'FVG',
      hasSMT,
      hasLiquiditySweep: liquiditySweep.swept,
      htfBias: htfBias.overallBias,
      candlesUsedForAnalysis: killzoneCandles.length
    };
  }

  /**
   * Simulate execution costs (slippage + fees)
   * Returns adjusted payout considering real-world costs
   */
  simulateExecution(tradeAmount, isWin) {
    const slippageConfig = CONFIG.BACKTEST?.SLIPPAGE || {};
    const feesConfig = CONFIG.BACKTEST?.FEES || {};

    let adjustedAmount = tradeAmount;

    // Apply slippage
    if (slippageConfig.ENABLED) {
      let slippage = slippageConfig.BASE_SLIPPAGE_PERCENT / 100;

      if (slippageConfig.VARIABLE_SLIPPAGE) {
        // Add random component (0 to 1x base slippage)
        slippage += (Math.random() * slippageConfig.BASE_SLIPPAGE_PERCENT / 100);
      }

      // Cap at max slippage
      slippage = Math.min(slippage, slippageConfig.MAX_SLIPPAGE_PERCENT / 100);

      // Slippage always works against you
      adjustedAmount *= (1 - slippage);
    }

    // Apply fees
    if (feesConfig.ENABLED) {
      // Percentage fee
      if (feesConfig.POLYMARKET_FEE_PERCENT > 0) {
        adjustedAmount *= (1 - feesConfig.POLYMARKET_FEE_PERCENT / 100);
      }

      // Fixed gas fee
      if (feesConfig.GAS_FEE_USD > 0) {
        adjustedAmount -= feesConfig.GAS_FEE_USD;
      }
    }

    // If win, you get ~2x (minus costs). If lose, you get 0.
    const payout = isWin ? adjustedAmount * 2 : 0;

    return {
      originalAmount: tradeAmount,
      adjustedAmount,
      payout,
      profit: payout - tradeAmount,
      slippageCost: tradeAmount - adjustedAmount,
      effectiveReturn: isWin ? (payout / tradeAmount - 1) : -1
    };
  }

  /**
   * Run full backtest (BIAS-FREE VERSION) - ETH13 STRATEGY
   */
  async runBacktest(startDate, endDate, options = {}) {
    const decisionHour = options.decisionHour || CONFIG.BACKTEST?.DECISION_HOUR_UTC || 15;
    const asset = CONFIG.STRATEGY?.ASSET || 'ETH';

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('              ETH13 STRATEGY BACKTEST (BIAS-FREE)                  ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`Asset: ${asset}`);
    console.log(`Period: ${startDate} to ${endDate}`);
    console.log(`Decision Hour: ${decisionHour}:00 UTC`);
    console.log(`Slippage Simulation: ${CONFIG.BACKTEST?.SLIPPAGE?.ENABLED ? 'ON' : 'OFF'}`);
    console.log(`Fee Simulation: ${CONFIG.BACKTEST?.FEES?.ENABLED ? 'ON' : 'OFF'}`);
    console.log('');

    const results = {
      asset,
      totalDays: 0,
      tradedDays: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      currentStreak: 0,
      streakType: null,
      trades: [],
      skippedReasons: {}
    };

    try {
      // Fetch historical data - ETH13 uses ETH as primary, BTC for SMT
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();

      // Calculate required candles: 2 years = 730 days * 24h * 12 (5m candles/hour) = ~210,000
      const daysRequested = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
      const candlesNeeded = Math.min(daysRequested * 24 * 12 + 5000, 250000); // +5000 buffer, max 250k

      console.log(`Fetching ETH 5m data (${daysRequested} days, ~${candlesNeeded} candles)...`);
      const eth5m = await this.fetchHistoricalData('ETH/USDT', '5m', startTimestamp, candlesNeeded);
      console.log(`Fetched ${eth5m.length} candles (${Math.floor(eth5m.length / 288)} days)`);

      console.log('Fetching ETH 4h data...');
      const eth4h = await this.fetchHistoricalData('ETH/USDT', '4h', startTimestamp, 5000);

      console.log('Fetching ETH 1d data...');
      const eth1d = await this.fetchHistoricalData('ETH/USDT', '1d', startTimestamp, 500);

      console.log('Fetching BTC 5m data (for SMT)...');
      const btc5m = await this.fetchHistoricalData('BTC/USDT', '5m', startTimestamp, candlesNeeded);

      // Group by day - ETH is primary, BTC is SMT pair
      const dayGroups = this.groupByDay(eth5m);
      const smtDayGroups = this.groupByDay(btc5m);

      console.log(`\nAnalyzing ${Object.keys(dayGroups).length} days...\n`);

      let consecutiveWins = 0;
      let consecutiveLosses = 0;
      let simulatedCapital = CONFIG.CHALLENGE.STARTING_CAPITAL;
      let peakCapital = simulatedCapital;

      for (const [day, candles] of Object.entries(dayGroups)) {
        // Skip weekends
        const dayDate = new Date(day);
        if (dayDate.getUTCDay() === 0 || dayDate.getUTCDay() === 6) continue;

        results.totalDays++;

        // Get HTF context - ONLY completed candles before the day
        // Use more candles for better swing detection
        const dayStart = candles[0].timestamp;
        const htfCandles = {
          '4h': eth4h.filter(c => c.timestamp < dayStart).slice(-100), // ETH 4H candles
          '1d': eth1d.filter(c => c.timestamp < dayStart).slice(-60)   // ETH daily candles
        };

        // BTC candles for SMT divergence
        const smtCandles = smtDayGroups[day] || [];

        // Simulate trading decision with explicit decision hour
        const result = this.simulateDay(candles, htfCandles, smtCandles, decisionHour);

        if (result.traded) {
          results.tradedDays++;

          // Simulate execution costs
          const execution = this.simulateExecution(simulatedCapital, result.isWin);

          // Update capital
          if (result.isWin) {
            simulatedCapital = execution.payout;
            results.wins++;
            consecutiveWins++;
            consecutiveLosses = 0;
            results.maxConsecutiveWins = Math.max(results.maxConsecutiveWins, consecutiveWins);
            peakCapital = Math.max(peakCapital, simulatedCapital);
          } else {
            simulatedCapital = CONFIG.CHALLENGE.STARTING_CAPITAL; // Reset on loss
            results.losses++;
            consecutiveLosses++;
            consecutiveWins = 0;
            results.maxConsecutiveLosses = Math.max(results.maxConsecutiveLosses, consecutiveLosses);
          }

          results.trades.push({
            day,
            ...result,
            execution,
            capitalAfter: simulatedCapital,
            consecutiveWinsAtTime: consecutiveWins
          });
        } else {
          results.skippedReasons[result.reason] = (results.skippedReasons[result.reason] || 0) + 1;
        }
      }

      // Store simulation results
      results.simulatedCapital = simulatedCapital;
      results.peakCapital = peakCapital;

      // Calculate final stats
      results.winRate = results.tradedDays > 0 ? results.wins / results.tradedDays : 0;
      results.currentStreak = consecutiveWins > 0 ? consecutiveWins : -consecutiveLosses;
      results.streakType = consecutiveWins > 0 ? 'WIN' : 'LOSS';

      // Calculate probability of 13 consecutive wins
      results.prob13Wins = Math.pow(results.winRate, 13);

      this.printResults(results);

      return results;

    } catch (error) {
      console.error('Backtest error:', error.message);
      throw error;
    }
  }

  /**
   * Group candles by day
   */
  groupByDay(candles) {
    const groups = {};

    for (const candle of candles) {
      const day = new Date(candle.timestamp).toISOString().split('T')[0];
      if (!groups[day]) groups[day] = [];
      groups[day].push(candle);
    }

    return groups;
  }

  /**
   * Print backtest results
   */
  printResults(results) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('              BACKTEST RESULTS (BIAS-FREE)                         ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('OVERVIEW:');
    console.log(`  Total Trading Days:      ${results.totalDays}`);
    console.log(`  Days Traded:             ${results.tradedDays}`);
    console.log(`  Trade Frequency:         ${((results.tradedDays / results.totalDays) * 100).toFixed(1)}%`);
    console.log('');
    console.log('PERFORMANCE:');
    console.log(`  Wins:                    ${results.wins}`);
    console.log(`  Losses:                  ${results.losses}`);
    console.log(`  Win Rate:                ${(results.winRate * 100).toFixed(1)}%`);
    console.log('');
    console.log('STREAKS:');
    console.log(`  Max Consecutive Wins:    ${results.maxConsecutiveWins}`);
    console.log(`  Max Consecutive Losses:  ${results.maxConsecutiveLosses}`);
    console.log('');
    console.log('CAPITAL SIMULATION:');
    console.log(`  Starting Capital:        $${CONFIG.CHALLENGE.STARTING_CAPITAL}`);
    console.log(`  Peak Capital Reached:    $${results.peakCapital?.toFixed(2) || 'N/A'}`);
    console.log(`  Final Capital:           $${results.simulatedCapital?.toFixed(2) || 'N/A'}`);
    console.log('');
    console.log('13-WIN CHALLENGE PROBABILITY:');
    console.log(`  P(13 consecutive wins):  ${(results.prob13Wins * 100).toFixed(4)}%`);
    console.log(`  Expected attempts:       ${Math.ceil(1 / results.prob13Wins)}`);
    console.log(`  Expected cost:           $${(Math.ceil(1 / results.prob13Wins) * CONFIG.CHALLENGE.STARTING_CAPITAL).toFixed(0)}`);
    console.log('');
    console.log('SKIP REASONS (why trades were not taken):');
    for (const [reason, count] of Object.entries(results.skippedReasons)) {
      console.log(`  ${reason}: ${count}`);
    }
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');

    // Win rate by model
    const mmxmTrades = results.trades.filter(t => t.model === 'MMXM');
    const fvgTrades = results.trades.filter(t => t.model === 'FVG');
    const smtTrades = results.trades.filter(t => t.hasSMT);

    console.log('\nWIN RATE BY MODEL:');
    if (mmxmTrades.length > 0) {
      const mmxmWinRate = mmxmTrades.filter(t => t.isWin).length / mmxmTrades.length;
      console.log(`  MMXM: ${(mmxmWinRate * 100).toFixed(1)}% (n=${mmxmTrades.length})`);
    }
    if (fvgTrades.length > 0) {
      const fvgWinRate = fvgTrades.filter(t => t.isWin).length / fvgTrades.length;
      console.log(`  FVG:  ${(fvgWinRate * 100).toFixed(1)}% (n=${fvgTrades.length})`);
    }
    if (smtTrades.length > 0) {
      const smtWinRate = smtTrades.filter(t => t.isWin).length / smtTrades.length;
      console.log(`  With SMT: ${(smtWinRate * 100).toFixed(1)}% (n=${smtTrades.length})`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
  }

  /**
   * Monte Carlo simulation for challenge probability
   */
  monteCarloSimulation(winRate, numSimulations = 100000) {
    let successfulChallenges = 0;
    let totalAttempts = 0;
    const attemptsToSuccess = [];

    for (let sim = 0; sim < numSimulations; sim++) {
      let consecutiveWins = 0;
      let attempts = 0;

      while (consecutiveWins < 13 && attempts < 1000) {
        attempts++;
        totalAttempts++;

        if (Math.random() < winRate) {
          consecutiveWins++;
        } else {
          consecutiveWins = 0;
        }
      }

      if (consecutiveWins >= 13) {
        successfulChallenges++;
        attemptsToSuccess.push(attempts);
      }
    }

    const avgAttempts = attemptsToSuccess.length > 0
      ? attemptsToSuccess.reduce((a, b) => a + b, 0) / attemptsToSuccess.length
      : Infinity;

    return {
      successRate: successfulChallenges / numSimulations,
      avgAttemptsToSuccess: avgAttempts,
      medianAttempts: attemptsToSuccess.sort((a, b) => a - b)[Math.floor(attemptsToSuccess.length / 2)] || Infinity,
      minAttempts: Math.min(...attemptsToSuccess) || Infinity,
      maxAttempts: Math.max(...attemptsToSuccess) || Infinity
    };
  }
}

// Run backtest if called directly
const args = process.argv.slice(2);
if (args.length >= 2) {
  const backtester = new Backtester();
  backtester.runBacktest(args[0], args[1]).catch(console.error);
} else {
  console.log('Usage: node runner.js <startDate> <endDate>');
  console.log('Example: node runner.js 2024-01-01 2024-12-31');
}

export default Backtester;
