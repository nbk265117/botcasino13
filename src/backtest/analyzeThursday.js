/**
 * Analyze Thursday trades to understand why win rate is lower
 */

import DataManager from '../data/dataManager.js';
import { MarketStructure, FairValueGap, LiquidityAnalysis, MMXM } from '../ict/index.js';

const dm = new DataManager();
const ms = new MarketStructure();
const fvg = new FairValueGap();
const liq = new LiquidityAnalysis();
const mmxm = new MMXM();

async function analyzeThursday() {
  const { eth5m, eth4h, eth1d } = await dm.getETH13Data('2024-01-01', '2025-12-31');

  const dayGroups = {};
  for (const c of eth5m) {
    const day = new Date(c.timestamp).toISOString().split('T')[0];
    if (!dayGroups[day]) dayGroups[day] = [];
    dayGroups[day].push(c);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                 THURSDAY ANALYSIS - WHY 55.6%?                     ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const thursdayTrades = [];

  for (const [day, candles] of Object.entries(dayGroups)) {
    const d = new Date(day);
    const dow = d.getUTCDay();
    if (dow !== 4) continue; // Thursday only

    const decisionHour = 15;
    const decisionTs = candles.find(c => new Date(c.timestamp).getUTCHours() >= decisionHour)?.timestamp;
    if (!decisionTs) continue;

    const available = candles.filter(c => c.timestamp <= decisionTs);
    const kz = available.filter(c => {
      const h = new Date(c.timestamp).getUTCHours();
      return (h >= 7 && h <= 10) || (h >= 13 && h < decisionHour);
    });
    if (kz.length < 15) continue;

    const dayStart = candles[0].timestamp;
    const htf = {
      '4h': eth4h.filter(c => c.timestamp < dayStart).slice(-100),
      '1d': eth1d.filter(c => c.timestamp < dayStart).slice(-60)
    };

    const htfBias = ms.getHTFBiasAlignment(htf);
    let dir = htfBias.overallBias;
    if (dir === 'NEUTRAL') {
      const ltf = ms.determineBias(kz);
      if (ltf.bias !== 'NEUTRAL') dir = ltf.bias;
      else continue;
    } else if (!htfBias.aligned) continue;

    const fvgEntry = fvg.isAtFVGEntry(kz, dir);
    if (!fvgEntry.valid) continue;

    const sweep = liq.hasRecentLiquiditySweep(kz, dir);
    const mmxmA = mmxm.analyzeMMXMCycle(kz, dir);

    let conf = 0;
    if (htfBias.aligned && htfBias.overallBias !== 'NEUTRAL') conf += 2;
    else conf += 1;
    if (sweep.swept) conf += 2;
    if (fvgEntry.valid) conf += 1.5;
    if (mmxmA.tradeable) conf += 2;

    if (conf < 5) continue;

    const dayClose = candles[candles.length - 1].close;
    const dayOpen = candles[0].open;
    const actual = dayClose > dayOpen ? 'BULLISH' : 'BEARISH';
    const isWin = actual === dir;
    const move = ((dayClose - dayOpen) / dayOpen * 100).toFixed(2);

    thursdayTrades.push({
      day,
      prediction: dir,
      actual,
      isWin,
      move,
      conf,
      hasSweep: sweep.swept,
      hasMMXM: mmxmA.tradeable,
      htfBias: htfBias.overallBias
    });
  }

  // Show all Thursday trades
  console.log('  All Thursday Trades:\n');
  console.log('  Date       | Pred    | Actual  | Move   | Conf | Sweep | Result');
  console.log('  -----------|---------|---------|--------|------|-------|-------');

  for (const t of thursdayTrades) {
    const result = t.isWin ? '✅ WIN' : '❌ LOSS';
    const sweep = t.hasSweep ? '✓' : '✗';
    const pred = t.prediction.padEnd(7);
    const act = t.actual.padEnd(7);
    const mv = t.move.padStart(6);
    console.log(`  ${t.day} | ${pred} | ${act} | ${mv}% | ${t.conf.toFixed(1)}  | ${sweep}     | ${result}`);
  }

  // Analysis
  const wins = thursdayTrades.filter(t => t.isWin);
  const losses = thursdayTrades.filter(t => !t.isWin);

  console.log('\n  ─────────────────────────────────────────────────────────────────');
  console.log(`\n  Total: ${thursdayTrades.length} trades | ${wins.length} wins | ${losses.length} losses`);
  console.log(`  Win Rate: ${(wins.length / thursdayTrades.length * 100).toFixed(1)}%`);

  // Pattern analysis
  console.log('\n  LOSS PATTERN ANALYSIS:');

  const lossWithSweep = losses.filter(t => t.hasSweep).length;
  const lossWithoutSweep = losses.filter(t => !t.hasSweep).length;
  console.log(`    With Sweep: ${lossWithSweep} losses`);
  console.log(`    Without Sweep: ${lossWithoutSweep} losses`);

  const lossBullish = losses.filter(t => t.prediction === 'BULLISH').length;
  const lossBearish = losses.filter(t => t.prediction === 'BEARISH').length;
  console.log(`    Predicted BULLISH: ${lossBullish} losses`);
  console.log(`    Predicted BEARISH: ${lossBearish} losses`);

  // Thursday specific issues
  console.log('\n  THURSDAY SPECIFIC ISSUES:');
  console.log('    • Jeudi = veille du weekend');
  console.log('    • Institutions ferment positions avant weekend');
  console.log('    • Reversals fréquents en fin de semaine');
  console.log('    • NFP (Non-Farm Payrolls) = souvent Vendredi');
  console.log('    • Anticipation NFP crée volatilité Jeudi');

  // Weekend analysis
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                 SATURDAY/SUNDAY ANALYSIS                           ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('  ⚠️  CRYPTO WEEKEND TRADING:\n');
  console.log('  • Marché crypto ouvert 24/7 MAIS...');
  console.log('  • Les killzones ICT sont basées sur les sessions FOREX');
  console.log('  • London/NY sessions = FERMÉES le weekend');
  console.log('  • Pas de flux institutionnel → patterns ICT invalides');
  console.log('  • Volume très faible → manipulation plus facile');
  console.log('  • Polymarket: marchés daily créés Lun-Ven seulement\n');

  console.log('  ❌ RECOMMANDATION: Ne PAS trader Samedi/Dimanche');
  console.log('     → Killzones ICT ne fonctionnent pas sans sessions forex');
  console.log('     → Pas de marchés Polymarket daily le weekend');
}

analyzeThursday().catch(console.error);
