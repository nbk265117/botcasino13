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
   * CRITICAL CHANGES TO PREVENT LOOK-AHEAD BIAS:
   * 1. Decision is made at a SPECIFIC time (decisionHour)
   * 2. Only candles BEFORE decision time are used for analysis
   * 3. HTF candles are filtered to only include COMPLETED candles
   * 4. Entry price is at decision time, not end of killzone
   *
   * @param {Array} dayCandles - All 5m candles for the day
   * @param {Object} htfCandles - Higher timeframe candles
   * @param {Array} ethDayCandles - ETH candles for SMT
   * @param {number} decisionHour - UTC hour when decision is made (default: 15 = 3PM UTC)
   */
  simulateDay(dayCandles, htfCandles, ethDayCandles, decisionHour = 15) {
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
      }).slice(-50),
      '1d': (htfCandles['1d'] || []).filter(c => {
        // Daily candles - only use previous days, not current day
        const candleDate = new Date(c.timestamp).toISOString().split('T')[0];
        const decisionDate = decisionTime.toISOString().split('T')[0];
        return candleDate < decisionDate;
      }).slice(-20)
    };

    // STEP 5: Analyze HTF bias with filtered data
    const htfBias = this.marketStructure.getHTFBiasAlignment(filteredHTF);

    if (!htfBias.aligned || htfBias.overallBias === 'NEUTRAL') {
      return { traded: false, reason: 'No HTF alignment' };
    }

    const expectedDirection = htfBias.overallBias;

    // STEP 6: Check for liquidity sweep with available candles only
    const liquiditySweep = this.liquidity.hasRecentLiquiditySweep(killzoneCandles, expectedDirection);

    if (!liquiditySweep.swept) {
      return { traded: false, reason: 'No liquidity sweep' };
    }

    // STEP 7: Check for valid entry model
    const fvgEntry = this.fvg.isAtFVGEntry(killzoneCandles, expectedDirection);
    const mmxmAnalysis = this.mmxm.analyzeMMXMCycle(killzoneCandles, expectedDirection);

    if (!fvgEntry.valid && !mmxmAnalysis.tradeable) {
      return { traded: false, reason: 'No valid entry model' };
    }

    // STEP 8: SMT check with aligned ETH candles
    let hasSMT = false;
    const ethAvailable = ethDayCandles.filter(c => c.timestamp <= decisionTimestamp);
    const ethKillzone = ethAvailable.filter(candle => {
      const hour = new Date(candle.timestamp).getUTCHours();
      return (hour >= 7 && hour <= 10) || (hour >= 13 && hour < decisionHour);
    });

    if (ethKillzone.length === killzoneCandles.length) {
      const smtCheck = this.smt.checkSMTConfirmation(killzoneCandles, ethKillzone, expectedDirection);
      hasSMT = smtCheck.confirmed;
    }

    // STEP 9: Calculate confluence
    let confluence = 0;
    if (htfBias.aligned) confluence += 2;
    if (liquiditySweep.swept) confluence += 2;
    if (fvgEntry.valid) confluence += 1;
    if (hasSMT) confluence += 1.5;

    if (confluence < 5) {
      return { traded: false, reason: `Low confluence: ${confluence}` };
    }

    // STEP 10: Entry price is at DECISION TIME (not end of day)
    const entryCandle = availableCandles[availableCandles.length - 1];
    const entryPrice = entryCandle.close;

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
      model: mmxmAnalysis.tradeable ? 'MMXM' : 'FVG',
      hasSMT,
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
   * Run full backtest (BIAS-FREE VERSION)
   */
  async runBacktest(startDate, endDate, options = {}) {
    const decisionHour = options.decisionHour || CONFIG.BACKTEST?.DECISION_HOUR_UTC || 15;

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('              ICT STRATEGY BACKTEST (BIAS-FREE)                    ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`Period: ${startDate} to ${endDate}`);
    console.log(`Decision Hour: ${decisionHour}:00 UTC`);
    console.log(`Slippage Simulation: ${CONFIG.BACKTEST?.SLIPPAGE?.ENABLED ? 'ON' : 'OFF'}`);
    console.log(`Fee Simulation: ${CONFIG.BACKTEST?.FEES?.ENABLED ? 'ON' : 'OFF'}`);
    console.log('');

    const results = {
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
      // Fetch historical data
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();

      console.log('Fetching BTC 5m data...');
      const btc5m = await this.fetchHistoricalData('BTC/USDT', '5m', startTimestamp, 50000);
      console.log(`Fetched ${btc5m.length} candles`);

      console.log('Fetching BTC 4h data...');
      const btc4h = await this.fetchHistoricalData('BTC/USDT', '4h', startTimestamp, 5000);

      console.log('Fetching BTC 1d data...');
      const btc1d = await this.fetchHistoricalData('BTC/USDT', '1d', startTimestamp, 500);

      console.log('Fetching ETH 5m data...');
      const eth5m = await this.fetchHistoricalData('ETH/USDT', '5m', startTimestamp, 50000);

      // Group by day
      const dayGroups = this.groupByDay(btc5m);
      const ethDayGroups = this.groupByDay(eth5m);

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
        const dayStart = candles[0].timestamp;
        const htfCandles = {
          '4h': btc4h.filter(c => c.timestamp < dayStart).slice(-50),
          '1d': btc1d.filter(c => c.timestamp < dayStart).slice(-20)
        };

        const ethCandles = ethDayGroups[day] || [];

        // Simulate trading decision with explicit decision hour
        const result = this.simulateDay(candles, htfCandles, ethCandles, decisionHour);

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
