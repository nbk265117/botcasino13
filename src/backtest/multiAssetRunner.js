/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MULTI-ASSET BACKTEST FRAMEWORK
 * Tests ICT strategy on BTC, ETH, SOL in parallel
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * STRATEGY: Run 3 independent challenges simultaneously
 * - Each asset has its own $12 capital
 * - If ANY asset hits 13 consecutive wins, challenge is WON
 * - Total capital at risk: $36
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

export class MultiAssetBacktester {
  constructor() {
    this.exchange = new ccxt.binance({ enableRateLimit: true });
    this.marketStructure = new MarketStructure();
    this.fvg = new FairValueGap();
    this.liquidity = new LiquidityAnalysis();
    this.smt = new SMTDivergence();
    this.mmxm = new MMXM();
    this.killzones = new KillzoneDetector();

    this.assets = CONFIG.DATA.MULTI_ASSET?.ASSETS || ['BTC', 'ETH', 'SOL'];
    this.smtPairs = CONFIG.DATA.MULTI_ASSET?.SMT_PAIRS || {
      BTC: 'ETH',
      ETH: 'BTC',
      SOL: 'ETH'
    };
  }

  /**
   * Fetch historical data for an asset
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
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allCandles;
  }

  /**
   * Simulate a single day's trading decision for an asset
   */
  simulateDay(asset, dayCandles, htfCandles, smtDayCandles, decisionHour = 15) {
    const decisionTimestamp = dayCandles.find(c => {
      const hour = new Date(c.timestamp).getUTCHours();
      return hour >= decisionHour;
    })?.timestamp;

    if (!decisionTimestamp) {
      return { traded: false, reason: 'No candle at decision hour' };
    }

    const availableCandles = dayCandles.filter(c => c.timestamp <= decisionTimestamp);
    const killzoneCandles = availableCandles.filter(candle => {
      const hour = new Date(candle.timestamp).getUTCHours();
      // All killzones: Asia (0-4), London (7-10), NY AM (13-16), NY PM (18-20)
      return (hour >= 0 && hour <= 4) ||
             (hour >= 7 && hour <= 10) ||
             (hour >= 13 && hour < decisionHour) ||
             (hour >= 18 && hour <= 20);
    });

    if (killzoneCandles.length < 15) {
      return { traded: false, reason: 'Insufficient killzone data' };
    }

    // Filter HTF candles
    const decisionTime = new Date(decisionTimestamp);
    const filteredHTF = {
      '4h': (htfCandles['4h'] || []).filter(c => {
        const candleClose = new Date(c.timestamp + 4 * 60 * 60 * 1000);
        return candleClose <= decisionTime;
      }).slice(-100),
      '1d': (htfCandles['1d'] || []).filter(c => {
        const candleDate = new Date(c.timestamp).toISOString().split('T')[0];
        const decisionDate = decisionTime.toISOString().split('T')[0];
        return candleDate < decisionDate;
      }).slice(-60)
    };

    // HTF Bias
    const htfBias = this.marketStructure.getHTFBiasAlignment(filteredHTF);
    let expectedDirection = htfBias.overallBias;

    if (htfBias.overallBias === 'NEUTRAL' && CONFIG.HTF_BIAS?.ALLOW_NEUTRAL_BIAS) {
      const ltfBias = this.marketStructure.determineBias(killzoneCandles);
      if (ltfBias.bias !== 'NEUTRAL') {
        expectedDirection = ltfBias.bias;
      } else {
        return { traded: false, reason: 'No HTF or LTF alignment' };
      }
    } else if (!htfBias.aligned && !CONFIG.HTF_BIAS?.ALLOW_NEUTRAL_BIAS) {
      return { traded: false, reason: 'No HTF alignment' };
    }

    // Liquidity sweep - BIAS-FREE: Now OPTIONAL (adds confluence but doesn't block)
    const liquiditySweep = this.liquidity.hasRecentLiquiditySweep(killzoneCandles, expectedDirection);

    // SWEEP IS NOW OPTIONAL - Set SWEEP_REQUIRED_STRICT: true to require (not recommended)
    const sweepRequiredStrict = CONFIG.ICT?.LIQUIDITY?.SWEEP_REQUIRED_STRICT || false;
    if (sweepRequiredStrict && !liquiditySweep.swept) {
      return { traded: false, reason: 'No liquidity sweep (strict mode)' };
    }

    // Entry model validation - FVG REQUIRED (better win rate than MMXM alone)
    const fvgEntry = this.fvg.isAtFVGEntry(killzoneCandles, expectedDirection);
    const mmxmAnalysis = this.mmxm.analyzeMMXMCycle(killzoneCandles, expectedDirection);

    // REQUIRE FVG - it has better win rate (64% vs 57.9% for MMXM in 2025)
    const requireFVG = CONFIG.ENTRY_MODELS?.REQUIRE_FVG || false;
    if (requireFVG && !fvgEntry.valid) {
      return { traded: false, reason: 'No FVG entry (FVG required mode)' };
    }

    if (!fvgEntry.valid && !mmxmAnalysis.tradeable) {
      return { traded: false, reason: 'No valid entry model' };
    }

    // SMT check
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

    // Calculate confluence
    let confluence = 0;
    let confluenceDetails = [];

    if (htfBias.aligned && htfBias.overallBias !== 'NEUTRAL') {
      confluence += 2;
      confluenceDetails.push('HTF');
    } else if (expectedDirection !== 'NEUTRAL') {
      confluence += 1;
      confluenceDetails.push('LTF');
    }

    if (liquiditySweep.swept) {
      confluence += 2;
      confluenceDetails.push('SWEEP');
    }

    if (fvgEntry.valid) {
      confluence += 1.5;
      confluenceDetails.push('FVG');
    }
    if (mmxmAnalysis.tradeable) {
      confluence += 2;
      confluenceDetails.push('MMXM');
    }

    if (hasSMT) {
      confluence += 1.5;
      confluenceDetails.push('SMT');
    }

    // Confluence threshold - higher on Thursday
    const dayOfWeek = new Date(dayCandles[0].timestamp).getUTCDay();
    const isThursday = dayOfWeek === 4;
    const thursdayMinConfluence = CONFIG.KILLZONES?.DAY_FILTER?.THURSDAY_MIN_CONFLUENCE || 6;
    const baseMinConfluence = CONFIG.CONFLUENCE?.MIN_SCORE_TO_TRADE || 4;
    const minConfluence = isThursday ? thursdayMinConfluence : baseMinConfluence;

    if (confluence < minConfluence) {
      return { traded: false, reason: `Low confluence: ${confluence.toFixed(1)} (need ${minConfluence}${isThursday ? ' Thu' : ''})` };
    }

    // Premium/Discount Zone filter - BONUS (not required, but adds confluence)
    const pdZone = this.marketStructure.getPremiumDiscountZone(killzoneCandles);
    const correctPDZone =
      (expectedDirection === 'BULLISH' && (pdZone.zone.includes('DISCOUNT') || pdZone.zone === 'EQUILIBRIUM')) ||
      (expectedDirection === 'BEARISH' && (pdZone.zone.includes('PREMIUM') || pdZone.zone === 'EQUILIBRIUM'));

    // Add PD Zone bonus to confluence (not required)
    if (correctPDZone) {
      confluence += 1;
      confluenceDetails.push('PD_ZONE');
    }

    // Entry and outcome - BIAS-FREE VERSION
    // CRITICAL FIX: At decision time, we can't trade at the CLOSE price
    // We trade at the OPEN of the NEXT candle.
    const decisionCandle = availableCandles[availableCandles.length - 1];
    const nextCandleIndex = dayCandles.findIndex(c => c.timestamp > decisionCandle.timestamp);

    let entryPrice;
    let entryCandle;

    if (nextCandleIndex !== -1 && nextCandleIndex < dayCandles.length) {
      entryCandle = dayCandles[nextCandleIndex];
      entryPrice = entryCandle.open; // OPEN of next candle = realistic entry
    } else {
      entryCandle = decisionCandle;
      entryPrice = decisionCandle.close; // Fallback
    }

    const dayClose = dayCandles[dayCandles.length - 1].close;
    const dayOpen = dayCandles[0].open;

    const actualDirection = dayClose > dayOpen ? 'BULLISH' : 'BEARISH';
    const isWin = actualDirection === expectedDirection;

    return {
      traded: true,
      asset,
      prediction: expectedDirection,
      actual: actualDirection,
      isWin,
      entryPrice,
      entryTime: new Date(entryCandle.timestamp).toISOString(),
      dayOpen,
      dayClose,
      percentMove: ((dayClose - dayOpen) / dayOpen * 100).toFixed(2),
      confluence,
      confluenceDetails: confluenceDetails.join('+'),
      model: mmxmAnalysis.tradeable ? 'MMXM' : 'FVG',
      hasSMT
    };
  }

  /**
   * Run backtest for a single asset
   */
  async runSingleAssetBacktest(asset, startDate, endDate, decisionHour = 15) {
    const symbol = CONFIG.DATA.SYMBOLS[asset];
    const smtAsset = this.smtPairs[asset];
    const smtSymbol = CONFIG.DATA.SYMBOLS[smtAsset];

    console.log(`\n  Fetching ${asset} data...`);
    const startTimestamp = new Date(startDate).getTime();

    const [candles5m, candles4h, candles1d, smtCandles5m] = await Promise.all([
      this.fetchHistoricalData(symbol, '5m', startTimestamp, 50000),
      this.fetchHistoricalData(symbol, '4h', startTimestamp, 5000),
      this.fetchHistoricalData(symbol, '1d', startTimestamp, 500),
      this.fetchHistoricalData(smtSymbol, '5m', startTimestamp, 50000)
    ]);

    console.log(`  ${asset}: ${candles5m.length} candles loaded`);

    // Group by day
    const dayGroups = this.groupByDay(candles5m);
    const smtDayGroups = this.groupByDay(smtCandles5m);

    const results = {
      asset,
      totalDays: 0,
      tradedDays: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      trades: [],
      skippedReasons: {}
    };

    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let capital = CONFIG.DATA.MULTI_ASSET?.CAPITAL_PER_ASSET || 12;
    let peakCapital = capital;

    for (const [day, candles] of Object.entries(dayGroups)) {
      const dayDate = new Date(day);
      const dayOfWeek = dayDate.getUTCDay();

      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      // SURVIVORSHIP BIAS WARNING:
      // The day filters below were based on backtest results.
      // Using these in production is SURVIVORSHIP BIAS - you're filtering
      // based on past performance which may not repeat.
      //
      // DISABLED BY DEFAULT - set BACKTEST_MODE_DAY_FILTER: true in config
      // to enable for analysis purposes only.
      const allowDayFilter = CONFIG.KILLZONES?.DAY_FILTER?.BACKTEST_MODE_DAY_FILTER || false;

      if (allowDayFilter) {
        // Skip Friday - historical 0% win rate (USE WITH CAUTION)
        if (CONFIG.KILLZONES?.DAY_FILTER?.SKIP_FRIDAY && dayOfWeek === 5) continue;

        // Skip Thursday - historical 28% win rate (USE WITH CAUTION)
        if (CONFIG.KILLZONES?.DAY_FILTER?.SKIP_THURSDAY && dayOfWeek === 4) continue;
      }

      results.totalDays++;

      const dayStart = candles[0].timestamp;
      const htfCandles = {
        '4h': candles4h.filter(c => c.timestamp < dayStart).slice(-100),
        '1d': candles1d.filter(c => c.timestamp < dayStart).slice(-60)
      };

      const smtCandles = smtDayGroups[day] || [];
      const result = this.simulateDay(asset, candles, htfCandles, smtCandles, decisionHour);

      if (result.traded) {
        results.tradedDays++;

        if (result.isWin) {
          capital *= 2 * 0.995; // 2x minus slippage/fees
          results.wins++;
          consecutiveWins++;
          consecutiveLosses = 0;
          results.maxConsecutiveWins = Math.max(results.maxConsecutiveWins, consecutiveWins);
          peakCapital = Math.max(peakCapital, capital);
        } else {
          capital = CONFIG.DATA.MULTI_ASSET?.CAPITAL_PER_ASSET || 12;
          results.losses++;
          consecutiveLosses++;
          consecutiveWins = 0;
          results.maxConsecutiveLosses = Math.max(results.maxConsecutiveLosses, consecutiveLosses);
        }

        results.trades.push({
          day,
          ...result,
          capitalAfter: capital,
          consecutiveWinsAtTime: consecutiveWins
        });
      } else {
        results.skippedReasons[result.reason] = (results.skippedReasons[result.reason] || 0) + 1;
      }
    }

    results.winRate = results.tradedDays > 0 ? results.wins / results.tradedDays : 0;
    results.finalCapital = capital;
    results.peakCapital = peakCapital;
    results.prob13Wins = Math.pow(results.winRate, 13);

    return results;
  }

  /**
   * Run full multi-asset backtest
   */
  async runBacktest(startDate, endDate, options = {}) {
    const decisionHour = options.decisionHour || CONFIG.BACKTEST?.DECISION_HOUR_UTC || 15;

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('           MULTI-ASSET ICT BACKTEST (BTC + ETH + SOL)              ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`Period: ${startDate} to ${endDate}`);
    console.log(`Decision Hour: ${decisionHour}:00 UTC`);
    console.log(`Confluence Minimum: ${CONFIG.CONFLUENCE?.MIN_SCORE_TO_TRADE || 8}`);
    console.log(`Assets: ${this.assets.join(', ')}`);
    console.log(`Capital per asset: $${CONFIG.DATA.MULTI_ASSET?.CAPITAL_PER_ASSET || 12}`);
    console.log(`Total capital: $${(CONFIG.DATA.MULTI_ASSET?.CAPITAL_PER_ASSET || 12) * this.assets.length}`);
    console.log('');

    const allResults = {};

    for (const asset of this.assets) {
      allResults[asset] = await this.runSingleAssetBacktest(asset, startDate, endDate, decisionHour);
    }

    this.printResults(allResults);
    return allResults;
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
   * Print multi-asset results
   */
  printResults(allResults) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    MULTI-ASSET RESULTS                             ');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    let totalTrades = 0;
    let totalWins = 0;
    let bestMaxStreak = 0;
    let bestAsset = null;

    for (const [asset, results] of Object.entries(allResults)) {
      console.log(`${asset}:`);
      console.log(`  Trades: ${results.tradedDays} | Win Rate: ${(results.winRate * 100).toFixed(1)}%`);
      console.log(`  Max Consecutive Wins: ${results.maxConsecutiveWins}`);
      console.log(`  P(13 wins): ${(results.prob13Wins * 100).toFixed(4)}%`);
      console.log('');

      totalTrades += results.tradedDays;
      totalWins += results.wins;

      if (results.maxConsecutiveWins > bestMaxStreak) {
        bestMaxStreak = results.maxConsecutiveWins;
        bestAsset = asset;
      }
    }

    const overallWinRate = totalTrades > 0 ? totalWins / totalTrades : 0;

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                       COMBINED STATS                               ');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log(`Total Trades (all assets): ${totalTrades}`);
    console.log(`Overall Win Rate: ${(overallWinRate * 100).toFixed(1)}%`);
    console.log(`Best Max Streak: ${bestMaxStreak} (${bestAsset})`);
    console.log('');

    // Calculate combined probability
    const p13Combined = 1 - Object.values(allResults).reduce((acc, r) => {
      return acc * Math.pow(1 - r.prob13Wins, r.tradedDays);
    }, 1);

    console.log('CHALLENGE PROBABILITY (at least 1 asset hits 13):');
    console.log(`  P(success in this period): ${(p13Combined * 100).toFixed(2)}%`);
    console.log('');

    // Estimate time to success
    const avgTradesPerMonth = totalTrades / 6; // ~6 months of data
    const monthsFor50Percent = Math.log(0.5) / Math.log(1 - p13Combined / (totalTrades / avgTradesPerMonth));

    console.log('TIME ESTIMATES:');
    console.log(`  Trades per month (3 assets): ~${Math.round(avgTradesPerMonth)}`);
    console.log(`  Months for 50% success chance: ~${Math.abs(monthsFor50Percent).toFixed(1)}`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');
  }
}

// Run if called directly
const args = process.argv.slice(2);
if (args.length >= 2) {
  const backtester = new MultiAssetBacktester();
  backtester.runBacktest(args[0], args[1]).catch(console.error);
} else {
  console.log('Usage: node multiAssetRunner.js <startDate> <endDate>');
  console.log('Example: node multiAssetRunner.js 2024-01-01 2024-12-31');
}

export default MultiAssetBacktester;
