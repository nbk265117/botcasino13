/**
 * Bitcoin ETF Flows Module
 *
 * Tracks institutional money flow via Bitcoin ETF data:
 * - Daily inflows/outflows
 * - Cumulative holdings
 * - Individual ETF performance (IBIT, FBTC, GBTC, etc.)
 *
 * Strong inflows = Institutional buying = BULLISH
 * Strong outflows = Institutional selling = BEARISH
 *
 * Data sources:
 * - CoinGlass API (primary)
 * - Farside Investors (backup/scraping)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚠️  WARNING: LOOK-AHEAD BIAS IN BACKTEST MODE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module uses REAL-TIME APIs that return CURRENT data.
 * Using this in backtest mode would cause SEVERE LOOK-AHEAD BIAS:
 *
 * - Daily ETF flows: Returns TODAY's flows, not historical
 * - Weekly aggregates: Calculated from CURRENT data
 * - Holdings: Shows CURRENT holdings, not historical
 *
 * PRODUCTION: ✅ Safe to use (real-time data is appropriate)
 * BACKTEST:   ❌ DO NOT USE (would use future data to predict past)
 *
 * To use in backtest, you would need:
 * - Historical ETF flow database (e.g., from Farside archives)
 * - Point-in-time snapshots of daily flows
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { CONFIG } from '../../config/settings.js';

export class ETFFlows {
  constructor(options = {}) {
    this.config = CONFIG.DATA_SOURCES?.ETF_FLOWS || {};
    this.coinGlassApiKey = process.env.COINGLASS_API_KEY || '';
    this.cache = new Map();
    this.cacheExpiry = 15 * 60 * 1000; // 15 minutes (ETF data updates less frequently)

    // BACKTEST PROTECTION
    this.isBacktestMode = options.backtestMode || false;
    this.allowInBacktest = options.allowInBacktest || false;

    // ETF tickers and their typical behavior
    this.etfInfo = {
      'IBIT': { name: 'BlackRock', weight: 0.35, bullishBias: true },
      'FBTC': { name: 'Fidelity', weight: 0.25, bullishBias: true },
      'GBTC': { name: 'Grayscale', weight: 0.20, bullishBias: false }, // Often has outflows
      'ARKB': { name: 'ARK Invest', weight: 0.10, bullishBias: true },
      'BITB': { name: 'Bitwise', weight: 0.05, bullishBias: true },
      'HODL': { name: 'VanEck', weight: 0.05, bullishBias: true }
    };
  }

  /**
   * Check if we're being used inappropriately in backtest
   */
  _checkBacktestSafety(methodName) {
    if (this.isBacktestMode && !this.allowInBacktest) {
      const error = new Error(
        `⚠️ LOOK-AHEAD BIAS BLOCKED: ETFFlows.${methodName}() cannot be used in backtest mode.\n` +
        `This module uses real-time APIs that would cause severe look-ahead bias.\n` +
        `The backtest would use TODAY's ETF flows to make decisions about HISTORICAL trades.\n\n` +
        `Options:\n` +
        `1. Remove ETF flow analysis from backtest (recommended)\n` +
        `2. Use historical ETF flow data feed (e.g., Farside archives)\n` +
        `3. Set allowInBacktest: true (NOT RECOMMENDED - results will be invalid)`
      );
      error.code = 'LOOKAHEAD_BIAS_BLOCKED';
      throw error;
    }
  }

  /**
   * Get ETF flow data from CoinGlass
   */
  async getETFFlows() {
    // BACKTEST PROTECTION
    this._checkBacktestSafety('getETFFlows');

    const cacheKey = 'etf_flows';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.fetchCoinGlassData();
      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('ETF Flows error:', error.message);
      return this.getMockETFData();
    }
  }

  /**
   * CoinGlass API for ETF data
   * https://docs.coinglass.com/reference/bitcoin-etfs
   */
  async fetchCoinGlassData() {
    const headers = {
      'accept': 'application/json'
    };

    if (this.coinGlassApiKey) {
      headers['CG-API-KEY'] = this.coinGlassApiKey;
    }

    // Get ETF list with flows
    const response = await fetch(
      'https://open-api.coinglass.com/public/v2/bitcoin_etf/list',
      { headers }
    );

    if (!response.ok) {
      throw new Error(`CoinGlass API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.code !== '0' || !result.data) {
      throw new Error(result.msg || 'Invalid response from CoinGlass');
    }

    const etfList = result.data;

    // Calculate aggregates
    let totalFlowToday = 0;
    let totalFlowWeek = 0;
    let totalHoldings = 0;
    const etfDetails = [];

    for (const etf of etfList) {
      const ticker = etf.symbol || etf.name;
      const info = this.etfInfo[ticker] || { name: ticker, weight: 0.05, bullishBias: true };

      const flowToday = parseFloat(etf.changeUsd24h || etf.flowUsd || 0);
      const holdings = parseFloat(etf.holdingsUsd || etf.totalUsd || 0);

      totalFlowToday += flowToday;
      totalHoldings += holdings;

      etfDetails.push({
        ticker,
        name: info.name,
        flowToday,
        holdings,
        weight: info.weight,
        flowDirection: flowToday > 0 ? 'INFLOW' : flowToday < 0 ? 'OUTFLOW' : 'NEUTRAL'
      });
    }

    // Get historical flows for trend analysis
    const flowHistory = await this.getHistoricalFlows();

    // Calculate 7-day flow
    if (flowHistory.length >= 7) {
      totalFlowWeek = flowHistory.slice(-7).reduce((sum, day) => sum + day.flow, 0);
    }

    // Determine signal strength
    const signal = this.calculateFlowSignal(totalFlowToday, totalFlowWeek, totalHoldings);

    return {
      valid: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalFlowToday,
        totalFlowWeek,
        totalHoldings,
        flowDirection: totalFlowToday > 0 ? 'INFLOW' : totalFlowToday < 0 ? 'OUTFLOW' : 'NEUTRAL'
      },
      signal,
      etfDetails: etfDetails.sort((a, b) => Math.abs(b.flowToday) - Math.abs(a.flowToday)),
      flowHistory: flowHistory.slice(-14), // Last 14 days
      source: 'coinglass'
    };
  }

  /**
   * Get historical flow data
   */
  async getHistoricalFlows() {
    const cacheKey = 'etf_flow_history';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const headers = {
        'accept': 'application/json'
      };

      if (this.coinGlassApiKey) {
        headers['CG-API-KEY'] = this.coinGlassApiKey;
      }

      const response = await fetch(
        'https://open-api.coinglass.com/public/v2/bitcoin_etf/flows_history?days=30',
        { headers }
      );

      if (!response.ok) {
        return this.getMockHistoricalFlows();
      }

      const result = await response.json();

      if (result.code !== '0' || !result.data) {
        return this.getMockHistoricalFlows();
      }

      const history = result.data.map(day => ({
        date: day.date || day.timestamp,
        flow: parseFloat(day.flowUsd || day.netFlow || 0),
        holdings: parseFloat(day.totalUsd || day.holdings || 0)
      }));

      this.setCache(cacheKey, history);
      return history;

    } catch (error) {
      console.error('Historical flows error:', error.message);
      return this.getMockHistoricalFlows();
    }
  }

  /**
   * Calculate trading signal based on flows
   */
  calculateFlowSignal(dailyFlow, weeklyFlow, totalHoldings) {
    // Thresholds in USD millions
    const STRONG_DAILY_THRESHOLD = 500_000_000; // $500M
    const MODERATE_DAILY_THRESHOLD = 100_000_000; // $100M
    const STRONG_WEEKLY_THRESHOLD = 1_000_000_000; // $1B
    const MODERATE_WEEKLY_THRESHOLD = 300_000_000; // $300M

    let score = 0;
    let strength = 'WEAK';
    let bias = 'NEUTRAL';

    // Daily flow score (-50 to +50)
    if (Math.abs(dailyFlow) >= STRONG_DAILY_THRESHOLD) {
      score += dailyFlow > 0 ? 50 : -50;
      strength = 'STRONG';
    } else if (Math.abs(dailyFlow) >= MODERATE_DAILY_THRESHOLD) {
      score += dailyFlow > 0 ? 30 : -30;
      strength = 'MODERATE';
    } else {
      score += (dailyFlow / MODERATE_DAILY_THRESHOLD) * 20;
    }

    // Weekly flow score (-50 to +50)
    if (Math.abs(weeklyFlow) >= STRONG_WEEKLY_THRESHOLD) {
      score += weeklyFlow > 0 ? 50 : -50;
    } else if (Math.abs(weeklyFlow) >= MODERATE_WEEKLY_THRESHOLD) {
      score += weeklyFlow > 0 ? 30 : -30;
    } else {
      score += (weeklyFlow / MODERATE_WEEKLY_THRESHOLD) * 20;
    }

    // Normalize to -100 to +100
    score = Math.max(-100, Math.min(100, score));

    // Determine bias
    if (score >= 40) {
      bias = 'BULLISH';
    } else if (score <= -40) {
      bias = 'BEARISH';
    }

    // Confidence based on flow magnitude
    const confidence = Math.min(1, Math.abs(score) / 100 + 0.2);

    return {
      score,
      bias,
      strength,
      confidence,
      reasoning: this.getFlowReasoning(dailyFlow, weeklyFlow, bias)
    };
  }

  /**
   * Generate human-readable reasoning
   */
  getFlowReasoning(dailyFlow, weeklyFlow, bias) {
    const dailyFlowM = (dailyFlow / 1_000_000).toFixed(1);
    const weeklyFlowM = (weeklyFlow / 1_000_000).toFixed(1);

    const dailyDir = dailyFlow >= 0 ? 'inflow' : 'outflow';
    const weeklyDir = weeklyFlow >= 0 ? 'inflow' : 'outflow';

    return `Daily: $${Math.abs(dailyFlowM)}M ${dailyDir}, Weekly: $${Math.abs(weeklyFlowM)}M ${weeklyDir} → ${bias}`;
  }

  /**
   * Get ETF signal for trade decision
   */
  async getETFSignal(expectedDirection) {
    // BACKTEST PROTECTION
    this._checkBacktestSafety('getETFSignal');

    const flows = await this.getETFFlows();

    if (!flows.valid) {
      return {
        aligned: false,
        reason: 'No ETF flow data available',
        score: 0
      };
    }

    const { signal, summary } = flows;

    // Check alignment
    const aligned = (
      (expectedDirection === 'BULLISH' && signal.bias === 'BULLISH') ||
      (expectedDirection === 'BEARISH' && signal.bias === 'BEARISH') ||
      signal.bias === 'NEUTRAL'
    );

    // Strong disagreement is a warning
    const strongDisagreement = (
      (expectedDirection === 'BULLISH' && signal.score < -60) ||
      (expectedDirection === 'BEARISH' && signal.score > 60)
    );

    return {
      aligned,
      strongDisagreement,
      bias: signal.bias,
      score: signal.score,
      confidence: signal.confidence,
      strength: signal.strength,
      reason: signal.reasoning,
      details: {
        dailyFlow: summary.totalFlowToday,
        weeklyFlow: summary.totalFlowWeek,
        totalHoldings: summary.totalHoldings
      }
    };
  }

  /**
   * Check for significant flow events (large single-day moves)
   */
  async checkSignificantFlowEvent() {
    const flows = await this.getETFFlows();

    if (!flows.valid) return null;

    const { summary, etfDetails } = flows;

    // Check for unusually large daily flow
    const SIGNIFICANT_THRESHOLD = 300_000_000; // $300M

    if (Math.abs(summary.totalFlowToday) >= SIGNIFICANT_THRESHOLD) {
      // Find biggest contributor
      const biggestMover = etfDetails[0];

      return {
        type: summary.totalFlowToday > 0 ? 'LARGE_INFLOW' : 'LARGE_OUTFLOW',
        amount: summary.totalFlowToday,
        direction: summary.totalFlowToday > 0 ? 'BULLISH' : 'BEARISH',
        biggestContributor: biggestMover,
        significance: 'HIGH',
        message: `Significant ETF ${summary.totalFlowToday > 0 ? 'inflow' : 'outflow'}: $${(Math.abs(summary.totalFlowToday) / 1_000_000).toFixed(0)}M`
      };
    }

    return null;
  }

  /**
   * Mock data when API not available
   */
  getMockETFData() {
    return {
      valid: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalFlowToday: 0,
        totalFlowWeek: 0,
        totalHoldings: 100_000_000_000,
        flowDirection: 'NEUTRAL'
      },
      signal: {
        score: 0,
        bias: 'NEUTRAL',
        strength: 'WEAK',
        confidence: 0.3,
        reasoning: 'Using mock data - set COINGLASS_API_KEY for real data'
      },
      etfDetails: [],
      flowHistory: [],
      source: 'mock',
      note: 'Using mock data'
    };
  }

  getMockHistoricalFlows() {
    const history = [];
    const now = new Date();

    for (let i = 30; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      history.push({
        date: date.toISOString().split('T')[0],
        flow: 0,
        holdings: 100_000_000_000
      });
    }

    return history;
  }

  /**
   * Cache helpers
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}

export default ETFFlows;
