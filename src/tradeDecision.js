/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TRADE DECISION ENGINE
 * ICT-Based Binary Direction Predictor for Polymarket BTC Markets
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * OBJECTIVE: Maximize win probability for 13 consecutive wins
 *
 * DECISION TREE:
 *
 *  START
 *    │
 *    ├─► Is it a trading day? (not weekend/holiday)
 *    │     NO ──► NO TRADE
 *    │
 *    ├─► Is news blackout active? (FOMC, CPI, NFP)
 *    │     YES ──► NO TRADE
 *    │
 *    ├─► Is killzone active?
 *    │     NO ──► NO TRADE (wait)
 *    │
 *    ├─► Is volatility within range?
 *    │     NO ──► NO TRADE (too quiet or too chaotic)
 *    │
 *    ├─► What is HTF bias? (4H, Daily, Weekly)
 *    │     NEUTRAL ──► NO TRADE
 *    │
 *    ├─► Has liquidity been swept?
 *    │     NO ──► NO TRADE (mandatory requirement)
 *    │
 *    ├─► Entry Model Check (FVG, MMXM, or Judas Swing)
 *    │     NO VALID MODEL ──► NO TRADE
 *    │
 *    ├─► SMT Divergence Confirmation?
 *    │     (Adds confluence, not mandatory)
 *    │
 *    ├─► Calculate confluence score
 *    │     SCORE < 7 ──► NO TRADE
 *    │
 *    └─► EXECUTE TRADE (LONG or SHORT)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { CONFIG } from '../config/settings.js';
import {
  MarketStructure,
  FairValueGap,
  LiquidityAnalysis,
  SMTDivergence,
  MMXM,
  KillzoneDetector
} from './ict/index.js';
import { PriceDataFetcher } from './data/priceData.js';
import { NewsFilter } from './filters/newsFilter.js';
// NEW: External data sources
import { NewsSentiment } from './data/newsSentiment.js';
import { ETFFlows } from './data/etfFlows.js';
import { EconomicCalendar } from './data/economicCalendar.js';

export class TradeDecisionEngine {
  constructor() {
    // Initialize all ICT analysis modules
    this.marketStructure = new MarketStructure();
    this.fvg = new FairValueGap();
    this.liquidity = new LiquidityAnalysis();
    this.smt = new SMTDivergence();
    this.mmxm = new MMXM();
    this.killzones = new KillzoneDetector();
    this.priceData = new PriceDataFetcher();
    this.newsFilter = new NewsFilter();

    // NEW: External data sources
    this.newsSentiment = new NewsSentiment();
    this.etfFlows = new ETFFlows();
    this.economicCalendar = new EconomicCalendar();

    // State tracking
    this.tradesToday = 0;
    this.lastTradeDate = null;
    this.consecutiveWins = 0;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * MAIN DECISION FUNCTION
   * Returns: { action: 'NO_TRADE' | 'LONG' | 'SHORT', ... }
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async makeDecision() {
    const decision = {
      timestamp: new Date().toISOString(),
      action: 'NO_TRADE',
      direction: null,
      confidence: 0,
      confluenceScore: 0,
      reasons: [],
      analysis: {}
    };

    try {
      // ─────────────────────────────────────────────────────────────────────
      // STEP 1: Trading Day Check
      // ─────────────────────────────────────────────────────────────────────
      const dayCheck = this.killzones.shouldSkipToday();
      if (dayCheck.skip) {
        decision.reasons.push(`SKIP: ${dayCheck.reason}`);
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 2: News Blackout Check
      // ─────────────────────────────────────────────────────────────────────
      const newsCheck = await this.newsFilter.checkNewsBlackout();
      decision.analysis.news = newsCheck;

      if (newsCheck.blackout) {
        decision.reasons.push(`NEWS BLACKOUT: ${newsCheck.event} in ${newsCheck.minutesUntil}min`);
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 3: Killzone Check
      // ─────────────────────────────────────────────────────────────────────
      const killzoneStatus = this.killzones.getTradingWindowStatus();
      decision.analysis.killzone = killzoneStatus;

      if (!killzoneStatus.canTrade) {
        decision.reasons.push(`OUTSIDE KILLZONE: ${killzoneStatus.reason || 'Wait for London/NY session'}`);
        if (killzoneStatus.quality?.nextKillzone) {
          decision.reasons.push(`Next: ${killzoneStatus.quality.nextKillzone.name} in ${killzoneStatus.quality.nextKillzone.hoursUntil}h`);
        }
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 4: Fetch Market Data
      // ─────────────────────────────────────────────────────────────────────
      const marketData = await this.priceData.getAnalysisData();
      decision.analysis.price = marketData.btc.ticker;

      // ─────────────────────────────────────────────────────────────────────
      // STEP 5: Volatility Filter
      // ─────────────────────────────────────────────────────────────────────
      decision.analysis.volatility = marketData.volatility;

      if (!marketData.volatility.isVolatilityOK) {
        const atrPct = marketData.volatility.atrPercent.toFixed(2);
        if (marketData.volatility.atrPercent < CONFIG.FILTERS.VOLATILITY.MIN_ATR_PERCENT) {
          decision.reasons.push(`LOW VOLATILITY: ATR ${atrPct}% - no edge in quiet market`);
        } else {
          decision.reasons.push(`HIGH VOLATILITY: ATR ${atrPct}% - too unpredictable`);
        }
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 6: HTF Bias Analysis
      // ─────────────────────────────────────────────────────────────────────
      const htfBias = this.marketStructure.getHTFBiasAlignment(marketData.btc.multiTimeframe);
      decision.analysis.htfBias = htfBias;

      if (!htfBias.aligned || htfBias.overallBias === 'NEUTRAL') {
        decision.reasons.push(`NO HTF ALIGNMENT: ${htfBias.bullishCount}B/${htfBias.bearishCount}Be - mixed signals`);
        return decision;
      }

      const expectedDirection = htfBias.overallBias;
      decision.direction = expectedDirection;

      // ─────────────────────────────────────────────────────────────────────
      // STEP 6.5: EXTERNAL DATA ANALYSIS (News, ETF Flows, Economic)
      // ─────────────────────────────────────────────────────────────────────
      const externalData = await this.analyzeExternalData(expectedDirection);
      decision.analysis.externalData = externalData;

      // Check for economic calendar blackout (high-impact events)
      if (externalData.economic?.canTrade === false) {
        decision.reasons.push(`ECONOMIC EVENT BLACKOUT: ${externalData.economic.reason}`);
        return decision;
      }

      // Check for ETF flow strong disagreement (optional block)
      if (CONFIG.DATA_SOURCES?.ETF_FLOWS?.BLOCK_ON_STRONG_DISAGREEMENT &&
          externalData.etf?.strongDisagreement) {
        decision.reasons.push(`ETF FLOW DISAGREEMENT: ${externalData.etf.reason}`);
        decision.reasons.push(`ETF Signal: ${externalData.etf.bias} vs Trade: ${expectedDirection}`);
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 7: LIQUIDITY SWEEP CHECK (MANDATORY)
      // ─────────────────────────────────────────────────────────────────────
      const btcCandles = marketData.btc.candles5m;
      const liquiditySweep = this.liquidity.hasRecentLiquiditySweep(btcCandles, expectedDirection);
      decision.analysis.liquiditySweep = liquiditySweep;

      if (!liquiditySweep.swept) {
        decision.reasons.push(`NO LIQUIDITY SWEEP: ${liquiditySweep.reason}`);
        decision.reasons.push('MANDATORY: Must sweep liquidity before entry');
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 8: Entry Model Validation
      // ─────────────────────────────────────────────────────────────────────
      const entryModels = this.validateEntryModels(btcCandles, marketData.eth.candles5m, expectedDirection);
      decision.analysis.entryModels = entryModels;

      if (!entryModels.validModel) {
        decision.reasons.push(`NO VALID ENTRY MODEL: ${entryModels.reason}`);
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 9: Calculate Confluence Score (including external data)
      // ─────────────────────────────────────────────────────────────────────
      const confluence = this.calculateConfluence({
        htfBias,
        killzoneStatus,
        liquiditySweep,
        entryModels,
        newsCheck,
        volatility: marketData.volatility,
        externalData  // NEW: Include external data in confluence
      }, btcCandles, marketData.eth.candles5m, expectedDirection);

      decision.confluenceScore = confluence.score;
      decision.analysis.confluence = confluence;

      if (confluence.score < CONFIG.CONFLUENCE.MIN_SCORE_TO_TRADE) {
        decision.reasons.push(`LOW CONFLUENCE: ${confluence.score}/${CONFIG.CONFLUENCE.MIN_SCORE_TO_TRADE} required`);
        decision.reasons.push(`Present: ${confluence.presentFactors.join(', ')}`);
        decision.reasons.push(`Missing: ${confluence.missingFactors.join(', ')}`);
        return decision;
      }

      // ─────────────────────────────────────────────────────────────────────
      // STEP 10: Daily Trade Limit Check
      // ─────────────────────────────────────────────────────────────────────
      const today = new Date().toISOString().split('T')[0];
      if (this.lastTradeDate !== today) {
        this.tradesToday = 0;
        this.lastTradeDate = today;
      }

      const isAPlusSetup = confluence.score >= CONFIG.CONFLUENCE.A_PLUS_SCORE;

      if (this.tradesToday >= CONFIG.CHALLENGE.MAX_TRADES_PER_DAY) {
        if (!isAPlusSetup || !CONFIG.CHALLENGE.ALLOW_SECOND_TRADE_IF_A_PLUS) {
          decision.reasons.push(`DAILY LIMIT: Already traded today (${this.tradesToday})`);
          return decision;
        }
        decision.reasons.push(`A+ SETUP (${confluence.score}/10): Allowing second trade`);
      }

      // ─────────────────────────────────────────────────────────────────────
      // DECISION: TRADE!
      // ─────────────────────────────────────────────────────────────────────
      decision.action = expectedDirection === 'BULLISH' ? 'LONG' : 'SHORT';
      decision.confidence = entryModels.winRateEstimate;
      decision.reasons.push(`✓ TRADE SIGNAL: ${decision.action}`);
      decision.reasons.push(`✓ Model: ${entryModels.model}`);
      decision.reasons.push(`✓ Confluence: ${confluence.score}/10`);
      decision.reasons.push(`✓ Win Rate Est: ${(entryModels.winRateEstimate * 100).toFixed(0)}%`);
      decision.reasons.push(`✓ HTF Bias: ${htfBias.overallBias} (${(htfBias.alignment * 100).toFixed(0)}% aligned)`);

      // Mark trade taken
      this.tradesToday++;

      return decision;

    } catch (error) {
      decision.reasons.push(`ERROR: ${error.message}`);
      decision.error = error;
      return decision;
    }
  }

  /**
   * Validate entry models (FVG, MMXM, Judas Swing)
   */
  validateEntryModels(btcCandles, ethCandles, expectedDirection) {
    const models = CONFIG.ENTRY_MODELS;
    const results = {
      validModel: false,
      model: null,
      winRateEstimate: 0,
      reason: 'No model conditions met',
      details: {}
    };

    // ─────────────────────────────────────────────────────────────────────
    // Model 1: MMXM (Market Maker Model) - Highest priority
    // ─────────────────────────────────────────────────────────────────────
    if (models.MMXM.ENABLED) {
      const mmxmAnalysis = this.mmxm.analyzeMMXMCycle(btcCandles, expectedDirection);
      results.details.mmxm = mmxmAnalysis;

      if (mmxmAnalysis.tradeable && mmxmAnalysis.direction === expectedDirection) {
        results.validModel = true;
        results.model = 'MMXM';
        results.winRateEstimate = models.MMXM.WIN_RATE_ESTIMATE;
        results.reason = mmxmAnalysis.entryReason;
        return results;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Model 2: FVG Entry after Displacement
    // ─────────────────────────────────────────────────────────────────────
    if (models.FVG_DISPLACEMENT.ENABLED) {
      const fvgEntry = this.fvg.isAtFVGEntry(btcCandles, expectedDirection);
      const pdZone = this.marketStructure.getPremiumDiscountZone(btcCandles);

      results.details.fvg = { fvgEntry, pdZone };

      // For bullish, want to be in discount; for bearish, want to be in premium
      const correctZone = (expectedDirection === 'BULLISH' && pdZone.zone.includes('DISCOUNT')) ||
                         (expectedDirection === 'BEARISH' && pdZone.zone.includes('PREMIUM'));

      if (fvgEntry.valid && correctZone) {
        results.validModel = true;
        results.model = 'FVG_DISPLACEMENT';
        results.winRateEstimate = models.FVG_DISPLACEMENT.WIN_RATE_ESTIMATE;
        results.reason = `FVG entry at ${pdZone.zone} zone`;
        return results;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Model 3: Judas Swing
    // ─────────────────────────────────────────────────────────────────────
    if (models.JUDAS_SWING.ENABLED) {
      const sessionOpen = this.killzones.getSessionOpenInfo();

      if (sessionOpen.withinSessionOpen) {
        // Find session open candle
        const sessionOpenIndex = btcCandles.length - Math.floor(sessionOpen.minutesSinceOpen / 5) - 1;
        const judasSwing = this.mmxm.detectJudasSwing(btcCandles, sessionOpenIndex, expectedDirection);

        results.details.judasSwing = judasSwing;

        if (judasSwing.tradeable && judasSwing.expectedReversal === expectedDirection) {
          results.validModel = true;
          results.model = 'JUDAS_SWING';
          results.winRateEstimate = models.JUDAS_SWING.WIN_RATE_ESTIMATE;
          results.reason = `Judas swing at ${sessionOpen.session} open`;
          return results;
        }
      }
    }

    return results;
  }

  /**
   * Calculate confluence score
   */
  calculateConfluence(analysis, btcCandles, ethCandles, expectedDirection) {
    const factors = CONFIG.CONFLUENCE.FACTORS;
    let score = 0;
    const presentFactors = [];
    const missingFactors = [];

    // HTF Bias Aligned
    if (analysis.htfBias.aligned) {
      score += factors.HTF_BIAS_ALIGNED;
      presentFactors.push('HTF_BIAS');
    } else {
      missingFactors.push('HTF_BIAS');
    }

    // Killzone Active
    if (analysis.killzoneStatus.canTrade) {
      score += factors.KILLZONE_ACTIVE;
      presentFactors.push('KILLZONE');

      // Silver bullet bonus
      if (analysis.killzoneStatus.quality?.inSilverBullet?.active) {
        score += 0.5;
        presentFactors.push('SILVER_BULLET');
      }
    } else {
      missingFactors.push('KILLZONE');
    }

    // Liquidity Swept
    if (analysis.liquiditySweep.swept) {
      score += factors.LIQUIDITY_SWEPT;
      presentFactors.push('LIQUIDITY_SWEPT');
    } else {
      missingFactors.push('LIQUIDITY_SWEPT');
    }

    // FVG Present
    const fvgEntry = this.fvg.isAtFVGEntry(btcCandles, expectedDirection);
    if (fvgEntry.valid) {
      score += factors.FVG_PRESENT;
      presentFactors.push('FVG');
    } else {
      missingFactors.push('FVG');
    }

    // Premium/Discount Zone
    const pdZone = this.marketStructure.getPremiumDiscountZone(btcCandles);
    const correctZone = (expectedDirection === 'BULLISH' && pdZone.zone.includes('DISCOUNT')) ||
                       (expectedDirection === 'BEARISH' && pdZone.zone.includes('PREMIUM'));
    if (correctZone) {
      score += factors.PREMIUM_DISCOUNT_ZONE;
      presentFactors.push('PD_ZONE');
    } else {
      missingFactors.push('PD_ZONE');
    }

    // SMT Divergence (bonus, high value)
    const smtCheck = this.smt.checkSMTConfirmation(btcCandles, ethCandles, expectedDirection);
    if (smtCheck.confirmed) {
      score += factors.SMT_DIVERGENCE;
      presentFactors.push('SMT');
    } else {
      missingFactors.push('SMT');
    }

    // News Clear
    if (!analysis.newsCheck.blackout) {
      score += factors.NEWS_CLEAR;
      presentFactors.push('NEWS_CLEAR');
    } else {
      missingFactors.push('NEWS_CLEAR');
    }

    // ─────────────────────────────────────────────────────────────────────
    // NEW: External Data Factors
    // ─────────────────────────────────────────────────────────────────────

    // News Sentiment Aligned
    if (analysis.externalData?.sentiment?.aligned) {
      score += factors.NEWS_SENTIMENT_ALIGNED || 1.5;
      presentFactors.push(`SENTIMENT(${analysis.externalData.sentiment.bias})`);
    } else if (analysis.externalData?.sentiment) {
      missingFactors.push('NEWS_SENTIMENT');
    }

    // ETF Flows Aligned
    if (analysis.externalData?.etf?.aligned) {
      score += factors.ETF_FLOWS_ALIGNED || 2.0;
      presentFactors.push(`ETF_FLOWS(${analysis.externalData.etf.bias})`);
    } else if (analysis.externalData?.etf) {
      missingFactors.push('ETF_FLOWS');
    }

    // Economic Bias Aligned
    if (analysis.externalData?.economic?.aligned) {
      score += factors.ECONOMIC_BIAS_ALIGNED || 1.0;
      presentFactors.push(`ECONOMIC(${analysis.externalData.economic.bias})`);
    } else if (analysis.externalData?.economic) {
      missingFactors.push('ECONOMIC_BIAS');
    }

    return {
      score: Math.round(score * 10) / 10,
      maxScore: Object.values(factors).reduce((a, b) => a + b, 0),
      presentFactors,
      missingFactors,
      isAPlus: score >= CONFIG.CONFLUENCE.A_PLUS_SCORE
    };
  }

  /**
   * Analyze external data sources (News, ETF, Economic)
   */
  async analyzeExternalData(expectedDirection) {
    const results = {};

    // Fetch all external data in parallel
    const [sentimentSignal, etfSignal, economicSignal] = await Promise.allSettled([
      CONFIG.DATA_SOURCES?.NEWS_SENTIMENT?.ENABLED
        ? this.newsSentiment.getSentimentSignal(expectedDirection)
        : Promise.resolve(null),
      CONFIG.DATA_SOURCES?.ETF_FLOWS?.ENABLED
        ? this.etfFlows.getETFSignal(expectedDirection)
        : Promise.resolve(null),
      CONFIG.DATA_SOURCES?.ECONOMIC_CALENDAR?.ENABLED
        ? this.economicCalendar.getEconomicSignal(expectedDirection)
        : Promise.resolve(null)
    ]);

    // Process sentiment
    if (sentimentSignal.status === 'fulfilled' && sentimentSignal.value) {
      results.sentiment = sentimentSignal.value;
    }

    // Process ETF flows
    if (etfSignal.status === 'fulfilled' && etfSignal.value) {
      results.etf = etfSignal.value;
    }

    // Process economic calendar
    if (economicSignal.status === 'fulfilled' && economicSignal.value) {
      results.economic = economicSignal.value;
    }

    // Calculate aggregate external score
    let externalBullish = 0;
    let externalBearish = 0;

    if (results.sentiment?.bias === 'BULLISH') externalBullish++;
    if (results.sentiment?.bias === 'BEARISH') externalBearish++;
    if (results.etf?.bias === 'BULLISH') externalBullish++;
    if (results.etf?.bias === 'BEARISH') externalBearish++;
    if (results.economic?.bias === 'BULLISH') externalBullish++;
    if (results.economic?.bias === 'BEARISH') externalBearish++;

    results.aggregate = {
      bullishSignals: externalBullish,
      bearishSignals: externalBearish,
      overallBias: externalBullish > externalBearish ? 'BULLISH'
                 : externalBearish > externalBullish ? 'BEARISH'
                 : 'NEUTRAL',
      alignedWithTrade: (expectedDirection === 'BULLISH' && externalBullish >= externalBearish) ||
                       (expectedDirection === 'BEARISH' && externalBearish >= externalBullish)
    };

    return results;
  }

  /**
   * Get comprehensive analysis without making a trade decision
   */
  async getAnalysis() {
    const decision = await this.makeDecision();

    return {
      decision,
      summary: this.generateSummary(decision),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate human-readable summary
   */
  generateSummary(decision) {
    const lines = [
      '═══════════════════════════════════════════════════════════════════',
      '                    ICT TRADE ANALYSIS                             ',
      '═══════════════════════════════════════════════════════════════════',
      '',
      `Action: ${decision.action}`,
      `Direction: ${decision.direction || 'N/A'}`,
      `Confidence: ${(decision.confidence * 100).toFixed(0)}%`,
      `Confluence: ${decision.confluenceScore}/10`,
      '',
      'Reasons:',
      ...decision.reasons.map(r => `  • ${r}`),
      '',
      '═══════════════════════════════════════════════════════════════════'
    ];

    return lines.join('\n');
  }
}

export default TradeDecisionEngine;
