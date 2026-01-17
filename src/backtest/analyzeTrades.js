/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ETH13 TRADE ANALYSIS - Analyze losing trades to find patterns
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  MarketStructure,
  FairValueGap,
  LiquidityAnalysis,
  SMTDivergence,
  MMXM,
} from '../ict/index.js';
import { CONFIG } from '../../config/settings.js';
import DataManager from '../data/dataManager.js';

class TradeAnalyzer {
  constructor() {
    this.dataManager = new DataManager();
    this.marketStructure = new MarketStructure();
    this.fvg = new FairValueGap();
    this.liquidity = new LiquidityAnalysis();
    this.smt = new SMTDivergence();
    this.mmxm = new MMXM();
  }

  groupByDay(candles) {
    const groups = {};
    for (const candle of candles) {
      const day = new Date(candle.timestamp).toISOString().split('T')[0];
      if (!groups[day]) groups[day] = [];
      groups[day].push(candle);
    }
    return groups;
  }

  async analyzeAllTrades(startDate, endDate) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('              ETH13 LOSING TRADES ANALYSIS                          ');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`Period: ${startDate} to ${endDate}\n`);

    // Load data from cache (or fetch if not cached)
    const { eth5m, eth4h, eth1d, btc5m } = await this.dataManager.getETH13Data(startDate, endDate);

    const dayGroups = this.groupByDay(eth5m);
    const smtDayGroups = this.groupByDay(btc5m);

    const trades = [];
    const decisionHour = 15;

    for (const [day, candles] of Object.entries(dayGroups)) {
      const dayDate = new Date(day);
      if (dayDate.getUTCDay() === 0 || dayDate.getUTCDay() === 6) continue;

      const dayStart = candles[0].timestamp;
      const htfCandles = {
        '4h': eth4h.filter(c => c.timestamp < dayStart).slice(-100),
        '1d': eth1d.filter(c => c.timestamp < dayStart).slice(-60)
      };
      const smtCandles = smtDayGroups[day] || [];

      const result = this.simulateDayWithDetails(candles, htfCandles, smtCandles, decisionHour);
      if (result.traded) {
        trades.push({ day, ...result });
      }
    }

    // Separate winners and losers
    const winners = trades.filter(t => t.isWin);
    const losers = trades.filter(t => !t.isWin);

    console.log(`\nTotal Trades: ${trades.length}`);
    console.log(`Winners: ${winners.length} (${(winners.length/trades.length*100).toFixed(1)}%)`);
    console.log(`Losers: ${losers.length} (${(losers.length/trades.length*100).toFixed(1)}%)`);

    // Analyze patterns
    this.analyzeByDayOfWeek(trades);
    this.analyzeByConfluence(trades);
    this.analyzeByHTFBias(trades);
    this.analyzeByModel(trades);
    this.analyzeByVolatility(trades);
    this.analyzeByMonth(trades);
    this.analyzeConsecutivePatterns(trades);
    this.showLosingTradesDetails(losers);

    return { trades, winners, losers };
  }

  simulateDayWithDetails(dayCandles, htfCandles, smtDayCandles, decisionHour = 15) {
    const decisionTimestamp = dayCandles.find(c => {
      const hour = new Date(c.timestamp).getUTCHours();
      return hour >= decisionHour;
    })?.timestamp;

    if (!decisionTimestamp) {
      return { traded: false };
    }

    const availableCandles = dayCandles.filter(c => c.timestamp <= decisionTimestamp);
    const killzoneCandles = availableCandles.filter(candle => {
      const hour = new Date(candle.timestamp).getUTCHours();
      return (hour >= 7 && hour <= 10) || (hour >= 13 && hour < decisionHour);
    });

    if (killzoneCandles.length < 15) {
      return { traded: false };
    }

    // HTF Bias
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

    const htfBias = this.marketStructure.getHTFBiasAlignment(filteredHTF);
    let expectedDirection = htfBias.overallBias;

    if (htfBias.overallBias === 'NEUTRAL') {
      const ltfBias = this.marketStructure.determineBias(killzoneCandles);
      if (ltfBias.bias !== 'NEUTRAL') {
        expectedDirection = ltfBias.bias;
      } else {
        return { traded: false };
      }
    } else if (!htfBias.aligned) {
      return { traded: false };
    }

    // Liquidity sweep
    const liquiditySweep = this.liquidity.hasRecentLiquiditySweep(killzoneCandles, expectedDirection);

    // Entry models
    const fvgEntry = this.fvg.isAtFVGEntry(killzoneCandles, expectedDirection);
    const mmxmAnalysis = this.mmxm.analyzeMMXMCycle(killzoneCandles, expectedDirection);

    if (!fvgEntry.valid) {
      return { traded: false };
    }

    // SMT
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

    const minConfluence = CONFIG.CONFLUENCE?.MIN_SCORE_TO_TRADE || 4;
    if (confluence < minConfluence) {
      return { traded: false };
    }

    // Entry and outcome
    const decisionCandle = availableCandles[availableCandles.length - 1];
    const nextCandleIndex = dayCandles.findIndex(c => c.timestamp > decisionCandle.timestamp);

    let entryPrice;
    if (nextCandleIndex !== -1 && nextCandleIndex < dayCandles.length) {
      entryPrice = dayCandles[nextCandleIndex].open;
    } else {
      entryPrice = decisionCandle.close;
    }

    const dayClose = dayCandles[dayCandles.length - 1].close;
    const dayOpen = dayCandles[0].open;
    const actualDirection = dayClose > dayOpen ? 'BULLISH' : 'BEARISH';
    const isWin = actualDirection === expectedDirection;

    // Calculate volatility (daily range as %)
    const dayHigh = Math.max(...dayCandles.map(c => c.high));
    const dayLow = Math.min(...dayCandles.map(c => c.low));
    const volatility = ((dayHigh - dayLow) / dayOpen * 100).toFixed(2);

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
      confluenceDetails: confluenceDetails.join('+'),
      model: mmxmAnalysis.tradeable ? 'MMXM' : 'FVG',
      hasSMT,
      hasSweep: liquiditySweep.swept,
      htfBias: htfBias.overallBias,
      htfAligned: htfBias.aligned,
      volatility: parseFloat(volatility),
      dayOfWeek: new Date(dayCandles[0].timestamp).getUTCDay(),
      month: new Date(dayCandles[0].timestamp).getUTCMonth() + 1
    };
  }

  analyzeByDayOfWeek(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    WIN RATE BY DAY OF WEEK                         ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDay = {};

    for (const trade of trades) {
      const day = trade.dayOfWeek;
      if (!byDay[day]) byDay[day] = { wins: 0, losses: 0 };
      if (trade.isWin) byDay[day].wins++;
      else byDay[day].losses++;
    }

    for (const [day, stats] of Object.entries(byDay).sort((a, b) => a[0] - b[0])) {
      const total = stats.wins + stats.losses;
      const winRate = (stats.wins / total * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(parseFloat(winRate) / 5));
      console.log(`  ${days[day]}: ${winRate}% (${stats.wins}W/${stats.losses}L) ${bar}`);
    }
  }

  analyzeByConfluence(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    WIN RATE BY CONFLUENCE SCORE                    ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const byConf = {};

    for (const trade of trades) {
      const confBucket = Math.floor(trade.confluence);
      if (!byConf[confBucket]) byConf[confBucket] = { wins: 0, losses: 0 };
      if (trade.isWin) byConf[confBucket].wins++;
      else byConf[confBucket].losses++;
    }

    for (const [conf, stats] of Object.entries(byConf).sort((a, b) => a[0] - b[0])) {
      const total = stats.wins + stats.losses;
      const winRate = (stats.wins / total * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(parseFloat(winRate) / 5));
      console.log(`  Confluence ${conf}-${parseInt(conf)+1}: ${winRate}% (${stats.wins}W/${stats.losses}L) ${bar}`);
    }
  }

  analyzeByHTFBias(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    WIN RATE BY HTF BIAS                            ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const byBias = {};

    for (const trade of trades) {
      const bias = trade.htfBias;
      if (!byBias[bias]) byBias[bias] = { wins: 0, losses: 0 };
      if (trade.isWin) byBias[bias].wins++;
      else byBias[bias].losses++;
    }

    for (const [bias, stats] of Object.entries(byBias)) {
      const total = stats.wins + stats.losses;
      const winRate = (stats.wins / total * 100).toFixed(1);
      console.log(`  ${bias}: ${winRate}% (${stats.wins}W/${stats.losses}L)`);
    }

    // Analyze sweep impact
    console.log('\n  WITH vs WITHOUT Liquidity Sweep:');
    const withSweep = trades.filter(t => t.hasSweep);
    const withoutSweep = trades.filter(t => !t.hasSweep);

    if (withSweep.length > 0) {
      const sweepWinRate = (withSweep.filter(t => t.isWin).length / withSweep.length * 100).toFixed(1);
      console.log(`    With Sweep: ${sweepWinRate}% (n=${withSweep.length})`);
    }
    if (withoutSweep.length > 0) {
      const noSweepWinRate = (withoutSweep.filter(t => t.isWin).length / withoutSweep.length * 100).toFixed(1);
      console.log(`    Without Sweep: ${noSweepWinRate}% (n=${withoutSweep.length})`);
    }

    // SMT impact
    console.log('\n  WITH vs WITHOUT SMT Divergence:');
    const withSMT = trades.filter(t => t.hasSMT);
    const withoutSMT = trades.filter(t => !t.hasSMT);

    if (withSMT.length > 0) {
      const smtWinRate = (withSMT.filter(t => t.isWin).length / withSMT.length * 100).toFixed(1);
      console.log(`    With SMT: ${smtWinRate}% (n=${withSMT.length})`);
    }
    if (withoutSMT.length > 0) {
      const noSmtWinRate = (withoutSMT.filter(t => t.isWin).length / withoutSMT.length * 100).toFixed(1);
      console.log(`    Without SMT: ${noSmtWinRate}% (n=${withoutSMT.length})`);
    }
  }

  analyzeByModel(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    WIN RATE BY ENTRY MODEL                         ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const byModel = {};

    for (const trade of trades) {
      const model = trade.model;
      if (!byModel[model]) byModel[model] = { wins: 0, losses: 0 };
      if (trade.isWin) byModel[model].wins++;
      else byModel[model].losses++;
    }

    for (const [model, stats] of Object.entries(byModel)) {
      const total = stats.wins + stats.losses;
      const winRate = (stats.wins / total * 100).toFixed(1);
      console.log(`  ${model}: ${winRate}% (${stats.wins}W/${stats.losses}L)`);
    }
  }

  analyzeByVolatility(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    WIN RATE BY VOLATILITY                          ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const byVol = { low: { wins: 0, losses: 0 }, medium: { wins: 0, losses: 0 }, high: { wins: 0, losses: 0 } };

    for (const trade of trades) {
      let bucket;
      if (trade.volatility < 3) bucket = 'low';
      else if (trade.volatility < 6) bucket = 'medium';
      else bucket = 'high';

      if (trade.isWin) byVol[bucket].wins++;
      else byVol[bucket].losses++;
    }

    for (const [vol, stats] of Object.entries(byVol)) {
      const total = stats.wins + stats.losses;
      if (total === 0) continue;
      const winRate = (stats.wins / total * 100).toFixed(1);
      const range = vol === 'low' ? '<3%' : vol === 'medium' ? '3-6%' : '>6%';
      console.log(`  ${vol.toUpperCase()} (${range}): ${winRate}% (${stats.wins}W/${stats.losses}L)`);
    }
  }

  analyzeByMonth(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    WIN RATE BY MONTH                               ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const byMonth = {};

    for (const trade of trades) {
      const month = trade.month;
      if (!byMonth[month]) byMonth[month] = { wins: 0, losses: 0 };
      if (trade.isWin) byMonth[month].wins++;
      else byMonth[month].losses++;
    }

    for (const [month, stats] of Object.entries(byMonth).sort((a, b) => a[0] - b[0])) {
      const total = stats.wins + stats.losses;
      const winRate = (stats.wins / total * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(parseFloat(winRate) / 5));
      console.log(`  ${months[month]}: ${winRate}% (${stats.wins}W/${stats.losses}L) ${bar}`);
    }
  }

  analyzeConsecutivePatterns(trades) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    CONSECUTIVE WIN/LOSS STREAKS                    ');
    console.log('═══════════════════════════════════════════════════════════════════');

    let currentStreak = 0;
    let currentType = null;
    const streaks = [];

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      const type = trade.isWin ? 'W' : 'L';

      if (type === currentType) {
        currentStreak++;
      } else {
        if (currentStreak > 0) {
          streaks.push({ type: currentType, length: currentStreak, endIndex: i - 1, endDay: trades[i-1].day });
        }
        currentType = type;
        currentStreak = 1;
      }
    }
    if (currentStreak > 0) {
      streaks.push({ type: currentType, length: currentStreak, endIndex: trades.length - 1, endDay: trades[trades.length-1].day });
    }

    // Show longest win streaks
    const winStreaks = streaks.filter(s => s.type === 'W').sort((a, b) => b.length - a.length);
    console.log('\n  Longest WIN streaks:');
    winStreaks.slice(0, 5).forEach((s, i) => {
      console.log(`    ${i+1}. ${s.length} wins (ended ${s.endDay})`);
    });

    // Show longest loss streaks
    const lossStreaks = streaks.filter(s => s.type === 'L').sort((a, b) => b.length - a.length);
    console.log('\n  Longest LOSS streaks:');
    lossStreaks.slice(0, 5).forEach((s, i) => {
      console.log(`    ${i+1}. ${s.length} losses (ended ${s.endDay})`);
    });
  }

  showLosingTradesDetails(losers) {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('                    LOSING TRADES DETAILS                           ');
    console.log('═══════════════════════════════════════════════════════════════════');

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    console.log('\n  Recent losing trades:\n');
    console.log('  Date       | Day | Pred    | Actual  | Move   | Confluence | Sweep | SMT');
    console.log('  -----------|-----|---------|---------|--------|------------|-------|----');

    for (const trade of losers.slice(-20)) {
      const day = days[trade.dayOfWeek];
      const sweep = trade.hasSweep ? '✓' : '✗';
      const smt = trade.hasSMT ? '✓' : '✗';
      console.log(`  ${trade.day} | ${day} | ${trade.prediction.padEnd(7)} | ${trade.actual.padEnd(7)} | ${trade.percentMove.padStart(5)}% | ${trade.confluenceDetails.padEnd(10)} | ${sweep}     | ${smt}`);
    }

    // Common patterns in losses
    console.log('\n  PATTERNS IN LOSSES:');

    const lossByDay = {};
    const lossBySweep = { with: 0, without: 0 };
    const lossBySMT = { with: 0, without: 0 };

    for (const trade of losers) {
      // By day
      if (!lossByDay[trade.dayOfWeek]) lossByDay[trade.dayOfWeek] = 0;
      lossByDay[trade.dayOfWeek]++;

      // By sweep
      if (trade.hasSweep) lossBySweep.with++;
      else lossBySweep.without++;

      // By SMT
      if (trade.hasSMT) lossBySMT.with++;
      else lossBySMT.without++;
    }

    console.log(`\n  Losses by day:`);
    for (const [day, count] of Object.entries(lossByDay).sort((a, b) => b[1] - a[1])) {
      const pct = (count / losers.length * 100).toFixed(0);
      console.log(`    ${days[day]}: ${count} (${pct}%)`);
    }

    console.log(`\n  Losses by Sweep: With=${lossBySweep.with}, Without=${lossBySweep.without}`);
    console.log(`  Losses by SMT: With=${lossBySMT.with}, Without=${lossBySMT.without}`);
  }
}

// Run analysis
const args = process.argv.slice(2);
if (args.length >= 2) {
  const analyzer = new TradeAnalyzer();
  analyzer.analyzeAllTrades(args[0], args[1]).catch(console.error);
} else {
  console.log('Usage: node analyzeTrades.js <startDate> <endDate>');
  console.log('Example: node analyzeTrades.js 2024-01-01 2025-12-31');
}

export default TradeAnalyzer;
