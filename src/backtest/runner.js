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
   * Simulate a single day's trading decision
   */
  simulateDay(dayCandles, htfCandles, ethDayCandles) {
    // Find killzone candles only
    const killzoneCandles = dayCandles.filter(candle => {
      const hour = new Date(candle.timestamp).getUTCHours();
      // London: 7-10, NY AM: 13-16
      return (hour >= 7 && hour <= 10) || (hour >= 13 && hour <= 16);
    });

    if (killzoneCandles.length < 20) {
      return { traded: false, reason: 'Insufficient killzone data' };
    }

    // Analyze HTF bias
    const htfBias = this.marketStructure.getHTFBiasAlignment({
      '4h': htfCandles['4h'] || [],
      '1d': htfCandles['1d'] || []
    });

    if (!htfBias.aligned || htfBias.overallBias === 'NEUTRAL') {
      return { traded: false, reason: 'No HTF alignment' };
    }

    const expectedDirection = htfBias.overallBias;

    // Check for liquidity sweep
    const liquiditySweep = this.liquidity.hasRecentLiquiditySweep(killzoneCandles, expectedDirection);

    if (!liquiditySweep.swept) {
      return { traded: false, reason: 'No liquidity sweep' };
    }

    // Check for valid entry model
    const fvgEntry = this.fvg.isAtFVGEntry(killzoneCandles, expectedDirection);
    const mmxmAnalysis = this.mmxm.analyzeMMXMCycle(killzoneCandles, expectedDirection);

    if (!fvgEntry.valid && !mmxmAnalysis.tradeable) {
      return { traded: false, reason: 'No valid entry model' };
    }

    // SMT check (bonus)
    let hasSMT = false;
    if (ethDayCandles.length === killzoneCandles.length) {
      const smtCheck = this.smt.checkSMTConfirmation(killzoneCandles, ethDayCandles, expectedDirection);
      hasSMT = smtCheck.confirmed;
    }

    // Calculate confluence
    let confluence = 0;
    if (htfBias.aligned) confluence += 2;
    if (liquiditySweep.swept) confluence += 2;
    if (fvgEntry.valid) confluence += 1;
    if (hasSMT) confluence += 1.5;

    if (confluence < 5) {
      return { traded: false, reason: `Low confluence: ${confluence}` };
    }

    // TRADE SIGNAL - now check outcome
    const entryPrice = killzoneCandles[killzoneCandles.length - 1].close;
    const dayClose = dayCandles[dayCandles.length - 1].close;
    const dayOpen = dayCandles[0].open;

    // For Polymarket: did BTC close UP or DOWN vs daily open?
    const actualDirection = dayClose > dayOpen ? 'BULLISH' : 'BEARISH';
    const isWin = actualDirection === expectedDirection;

    return {
      traded: true,
      prediction: expectedDirection,
      actual: actualDirection,
      isWin,
      entryPrice,
      dayOpen,
      dayClose,
      percentMove: ((dayClose - dayOpen) / dayOpen * 100).toFixed(2),
      confluence,
      model: mmxmAnalysis.tradeable ? 'MMXM' : 'FVG',
      hasSMT
    };
  }

  /**
   * Run full backtest
   */
  async runBacktest(startDate, endDate, options = {}) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                    ICT STRATEGY BACKTEST                          ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`Period: ${startDate} to ${endDate}`);
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

      for (const [day, candles] of Object.entries(dayGroups)) {
        // Skip weekends
        const dayDate = new Date(day);
        if (dayDate.getUTCDay() === 0 || dayDate.getUTCDay() === 6) continue;

        results.totalDays++;

        // Get HTF context
        const htfCandles = {
          '4h': btc4h.filter(c => c.timestamp < candles[candles.length - 1].timestamp).slice(-50),
          '1d': btc1d.filter(c => c.timestamp < candles[candles.length - 1].timestamp).slice(-20)
        };

        const ethCandles = ethDayGroups[day] || [];

        // Simulate trading decision
        const result = this.simulateDay(candles, htfCandles, ethCandles);

        if (result.traded) {
          results.tradedDays++;
          results.trades.push({ day, ...result });

          if (result.isWin) {
            results.wins++;
            consecutiveWins++;
            consecutiveLosses = 0;
            results.maxConsecutiveWins = Math.max(results.maxConsecutiveWins, consecutiveWins);
          } else {
            results.losses++;
            consecutiveLosses++;
            consecutiveWins = 0;
            results.maxConsecutiveLosses = Math.max(results.maxConsecutiveLosses, consecutiveLosses);
          }
        } else {
          results.skippedReasons[result.reason] = (results.skippedReasons[result.reason] || 0) + 1;
        }
      }

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
    console.log('                    BACKTEST RESULTS                               ');
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
    console.log('13-WIN CHALLENGE PROBABILITY:');
    console.log(`  P(13 consecutive wins):  ${(results.prob13Wins * 100).toFixed(4)}%`);
    console.log(`  Expected attempts:       ${Math.ceil(1 / results.prob13Wins)}`);
    console.log('');
    console.log('SKIP REASONS:');
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
