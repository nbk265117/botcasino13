/**
 * Economic Calendar Module
 *
 * Tracks macro economic events that impact BTC:
 * - CPI (Consumer Price Index)
 * - FOMC (Fed Interest Rate Decisions)
 * - NFP (Non-Farm Payrolls)
 * - GDP, PPI, Unemployment
 *
 * Provides:
 * 1. Event filtering (no trade during high impact events)
 * 2. Directional bias based on actual vs expected
 *
 * Data sources:
 * - Finnhub (primary, free tier)
 * - Trading Economics (backup)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚠️  WARNING: LOOK-AHEAD BIAS IN BACKTEST MODE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module uses REAL-TIME APIs that return CURRENT data.
 * Using this in backtest mode would cause SEVERE LOOK-AHEAD BIAS:
 *
 * - Calendar events: Returns events from TODAY, not from backtest date
 * - Actual values: Uses CURRENT released values, not point-in-time values
 * - Blackout detection: Based on CURRENT time, not backtest time
 *
 * PRODUCTION: ✅ Safe to use (real-time data is appropriate)
 * BACKTEST:   ❌ DO NOT USE (would use future data to predict past)
 *
 * To use in backtest, you would need:
 * - Historical economic calendar with point-in-time actual values
 * - Archived event data from TradingEconomics or similar
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { CONFIG } from '../../config/settings.js';

export class EconomicCalendar {
  constructor(options = {}) {
    this.config = CONFIG.DATA_SOURCES?.ECONOMIC_CALENDAR || {};
    this.finnhubApiKey = process.env.FINNHUB_API_KEY || '';
    this.cache = new Map();
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour

    // BACKTEST PROTECTION
    this.isBacktestMode = options.backtestMode || false;
    this.allowInBacktest = options.allowInBacktest || false;

    // High impact events and their BTC correlation
    this.eventImpact = {
      // CPI: Higher = Hawkish = BEARISH for BTC
      'CPI': {
        importance: 'HIGH',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BEARISH', reason: 'CPI higher than expected → hawkish Fed → bearish BTC' };
          if (actual < expected) return { bias: 'BULLISH', reason: 'CPI lower than expected → dovish Fed → bullish BTC' };
          return { bias: 'NEUTRAL', reason: 'CPI in-line with expectations' };
        }
      },
      'Core CPI': {
        importance: 'HIGH',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BEARISH', reason: 'Core CPI hot → hawkish Fed' };
          if (actual < expected) return { bias: 'BULLISH', reason: 'Core CPI cool → dovish Fed' };
          return { bias: 'NEUTRAL', reason: 'Core CPI as expected' };
        }
      },

      // FOMC: Rate hike = BEARISH, Rate cut = BULLISH
      'FOMC': {
        importance: 'HIGH',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BEARISH', reason: 'Rate hike → bearish BTC' };
          if (actual < expected) return { bias: 'BULLISH', reason: 'Rate cut → bullish BTC' };
          return { bias: 'NEUTRAL', reason: 'Rates unchanged as expected' };
        }
      },
      'Fed Interest Rate Decision': {
        importance: 'HIGH',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BEARISH', reason: 'Hawkish surprise' };
          if (actual < expected) return { bias: 'BULLISH', reason: 'Dovish surprise' };
          return { bias: 'NEUTRAL', reason: 'As expected' };
        }
      },

      // NFP: Strong jobs = Hawkish = BEARISH (counterintuitive but true)
      'Nonfarm Payrolls': {
        importance: 'HIGH',
        interpretation: (actual, expected) => {
          if (actual > expected * 1.1) return { bias: 'BEARISH', reason: 'Strong jobs → Fed stays hawkish' };
          if (actual < expected * 0.9) return { bias: 'BULLISH', reason: 'Weak jobs → Fed may cut' };
          return { bias: 'NEUTRAL', reason: 'Jobs report in-line' };
        }
      },
      'NFP': {
        importance: 'HIGH',
        interpretation: (actual, expected) => {
          if (actual > expected * 1.1) return { bias: 'BEARISH', reason: 'Strong NFP → hawkish' };
          if (actual < expected * 0.9) return { bias: 'BULLISH', reason: 'Weak NFP → dovish' };
          return { bias: 'NEUTRAL', reason: 'NFP as expected' };
        }
      },

      // Unemployment: Higher = Dovish = BULLISH (Fed may ease)
      'Unemployment Rate': {
        importance: 'MEDIUM',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BULLISH', reason: 'Rising unemployment → Fed may ease' };
          if (actual < expected) return { bias: 'BEARISH', reason: 'Low unemployment → Fed stays tight' };
          return { bias: 'NEUTRAL', reason: 'Unemployment stable' };
        }
      },

      // GDP: Strong = BEARISH short-term (no need for cuts)
      'GDP': {
        importance: 'MEDIUM',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BEARISH', reason: 'Strong GDP → no rate cuts needed' };
          if (actual < expected) return { bias: 'BULLISH', reason: 'Weak GDP → potential rate cuts' };
          return { bias: 'NEUTRAL', reason: 'GDP as expected' };
        }
      },

      // PPI: Similar to CPI
      'PPI': {
        importance: 'MEDIUM',
        interpretation: (actual, expected) => {
          if (actual > expected) return { bias: 'BEARISH', reason: 'Hot PPI → inflation concerns' };
          if (actual < expected) return { bias: 'BULLISH', reason: 'Cool PPI → inflation easing' };
          return { bias: 'NEUTRAL', reason: 'PPI as expected' };
        }
      },

      // Retail Sales: Strong = Mixed (good economy but Fed stays tight)
      'Retail Sales': {
        importance: 'MEDIUM',
        interpretation: (actual, expected) => {
          if (actual > expected * 1.1) return { bias: 'NEUTRAL', reason: 'Strong retail but Fed implications mixed' };
          if (actual < expected * 0.9) return { bias: 'BULLISH', reason: 'Weak retail → Fed may ease' };
          return { bias: 'NEUTRAL', reason: 'Retail sales normal' };
        }
      },

      // Default for unknown events
      'default': {
        importance: 'LOW',
        interpretation: () => ({ bias: 'NEUTRAL', reason: 'Unknown event' })
      }
    };
  }

  /**
   * Check if we're being used inappropriately in backtest
   */
  _checkBacktestSafety(methodName) {
    if (this.isBacktestMode && !this.allowInBacktest) {
      const error = new Error(
        `⚠️ LOOK-AHEAD BIAS BLOCKED: EconomicCalendar.${methodName}() cannot be used in backtest mode.\n` +
        `This module uses real-time APIs that would cause severe look-ahead bias.\n` +
        `The backtest would use TODAY's economic calendar to make decisions about HISTORICAL trades.\n\n` +
        `Options:\n` +
        `1. Remove economic calendar from backtest (recommended)\n` +
        `2. Use historical economic data feed (e.g., TradingEconomics archives)\n` +
        `3. Set allowInBacktest: true (NOT RECOMMENDED - results will be invalid)`
      );
      error.code = 'LOOKAHEAD_BIAS_BLOCKED';
      throw error;
    }
  }

  /**
   * Get upcoming economic events
   */
  async getUpcomingEvents(daysAhead = 7) {
    // BACKTEST PROTECTION
    this._checkBacktestSafety('getUpcomingEvents');
    const cacheKey = `events_${daysAhead}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const events = await this.fetchFinnhubCalendar(daysAhead);
      this.setCache(cacheKey, events);
      return events;
    } catch (error) {
      console.error('Economic calendar error:', error.message);
      return this.getMockCalendar();
    }
  }

  /**
   * Finnhub Economic Calendar API
   * https://finnhub.io/docs/api/economic-calendar
   */
  async fetchFinnhubCalendar(daysAhead) {
    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + daysAhead);

    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];

    const url = this.finnhubApiKey
      ? `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${this.finnhubApiKey}`
      : `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.economicCalendar || data.economicCalendar.length === 0) {
      return { valid: true, events: [], source: 'finnhub' };
    }

    // Filter for US events (most impactful for BTC)
    const usEvents = data.economicCalendar.filter(e =>
      e.country === 'US' || e.country === 'United States'
    );

    // Enrich with our impact data
    const enrichedEvents = usEvents.map(event => {
      const eventKey = this.findEventKey(event.event);
      const impactInfo = this.eventImpact[eventKey] || this.eventImpact['default'];

      // Calculate interpretation if we have actual and estimate
      let interpretation = null;
      if (event.actual !== null && event.actual !== undefined) {
        const estimate = event.estimate || event.actual;
        interpretation = impactInfo.interpretation(
          parseFloat(event.actual),
          parseFloat(estimate)
        );
      }

      return {
        id: event.id,
        event: event.event,
        eventKey,
        country: event.country,
        date: event.time || event.date,
        timestamp: new Date(event.time || event.date).getTime(),
        actual: event.actual,
        estimate: event.estimate,
        previous: event.prev,
        unit: event.unit,
        importance: impactInfo.importance,
        interpretation,
        impact: event.impact || impactInfo.importance
      };
    });

    // Sort by date
    enrichedEvents.sort((a, b) => a.timestamp - b.timestamp);

    return {
      valid: true,
      events: enrichedEvents,
      highImpactEvents: enrichedEvents.filter(e => e.importance === 'HIGH'),
      source: 'finnhub'
    };
  }

  /**
   * Find matching event key for our impact definitions
   */
  findEventKey(eventName) {
    const name = eventName.toLowerCase();

    if (name.includes('cpi') && name.includes('core')) return 'Core CPI';
    if (name.includes('cpi')) return 'CPI';
    if (name.includes('fomc') || name.includes('fed') && name.includes('rate')) return 'FOMC';
    if (name.includes('nonfarm') || name.includes('non-farm') || name.includes('payroll')) return 'Nonfarm Payrolls';
    if (name.includes('unemployment')) return 'Unemployment Rate';
    if (name.includes('gdp')) return 'GDP';
    if (name.includes('ppi')) return 'PPI';
    if (name.includes('retail')) return 'Retail Sales';

    return 'default';
  }

  /**
   * Check if there's a blackout period for high-impact events
   */
  async checkEventBlackout() {
    const calendar = await this.getUpcomingEvents(2); // Check next 2 days

    if (!calendar.valid || !calendar.highImpactEvents) {
      return { inBlackout: false, reason: 'No calendar data' };
    }

    const now = Date.now();
    const blackoutBefore = (CONFIG.FILTERS?.NEWS?.BLACKOUT_MINUTES_BEFORE || 60) * 60 * 1000;
    const blackoutAfter = (CONFIG.FILTERS?.NEWS?.BLACKOUT_MINUTES_AFTER || 30) * 60 * 1000;

    for (const event of calendar.highImpactEvents) {
      const eventTime = event.timestamp;

      // Check if we're in blackout window
      if (now >= eventTime - blackoutBefore && now <= eventTime + blackoutAfter) {
        return {
          inBlackout: true,
          event: event.event,
          eventTime: new Date(eventTime).toISOString(),
          reason: `${event.event} blackout period active`,
          minutesUntilEvent: Math.round((eventTime - now) / 60000),
          minutesSinceEvent: Math.round((now - eventTime) / 60000)
        };
      }
    }

    // Find next upcoming high-impact event
    const upcomingHigh = calendar.highImpactEvents.find(e => e.timestamp > now);

    return {
      inBlackout: false,
      nextHighImpactEvent: upcomingHigh ? {
        event: upcomingHigh.event,
        date: new Date(upcomingHigh.timestamp).toISOString(),
        hoursUntil: Math.round((upcomingHigh.timestamp - now) / 3600000)
      } : null
    };
  }

  /**
   * Get directional bias from recent economic releases
   */
  async getEconomicBias() {
    // Get events from past 3 days and upcoming
    const calendar = await this.getUpcomingEvents(7);

    if (!calendar.valid) {
      return { valid: false, reason: 'No calendar data' };
    }

    const now = Date.now();
    const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);

    // Filter for recent high-impact events with actual data
    const recentReleases = calendar.events.filter(e =>
      e.importance === 'HIGH' &&
      e.actual !== null &&
      e.actual !== undefined &&
      e.timestamp >= threeDaysAgo &&
      e.timestamp <= now
    );

    if (recentReleases.length === 0) {
      return {
        valid: true,
        bias: 'NEUTRAL',
        confidence: 0.3,
        reason: 'No recent high-impact releases',
        recentEvents: []
      };
    }

    // Calculate weighted bias from recent releases
    let bullishScore = 0;
    let bearishScore = 0;

    const eventDetails = recentReleases.map(event => {
      if (event.interpretation) {
        if (event.interpretation.bias === 'BULLISH') bullishScore++;
        if (event.interpretation.bias === 'BEARISH') bearishScore++;
      }

      return {
        event: event.event,
        actual: event.actual,
        estimate: event.estimate,
        interpretation: event.interpretation
      };
    });

    // Determine overall bias
    let bias = 'NEUTRAL';
    let confidence = 0.5;

    if (bullishScore > bearishScore) {
      bias = 'BULLISH';
      confidence = bullishScore / (bullishScore + bearishScore + 1);
    } else if (bearishScore > bullishScore) {
      bias = 'BEARISH';
      confidence = bearishScore / (bullishScore + bearishScore + 1);
    }

    return {
      valid: true,
      bias,
      confidence,
      bullishSignals: bullishScore,
      bearishSignals: bearishScore,
      recentEvents: eventDetails,
      reason: `${bullishScore} bullish vs ${bearishScore} bearish signals from recent macro data`
    };
  }

  /**
   * Get economic signal for trade decision
   */
  async getEconomicSignal(expectedDirection) {
    // BACKTEST PROTECTION
    this._checkBacktestSafety('getEconomicSignal');

    const [blackout, bias] = await Promise.all([
      this.checkEventBlackout(),
      this.getEconomicBias()
    ]);

    // If in blackout, don't trade
    if (blackout.inBlackout) {
      return {
        canTrade: false,
        reason: blackout.reason,
        blackoutEvent: blackout.event,
        aligned: false
      };
    }

    if (!bias.valid) {
      return {
        canTrade: true,
        aligned: true, // Neutral if no data
        bias: 'NEUTRAL',
        reason: 'No recent economic data',
        confidence: 0.3
      };
    }

    // Check alignment
    const aligned = (
      (expectedDirection === 'BULLISH' && bias.bias === 'BULLISH') ||
      (expectedDirection === 'BEARISH' && bias.bias === 'BEARISH') ||
      bias.bias === 'NEUTRAL'
    );

    return {
      canTrade: true,
      aligned,
      bias: bias.bias,
      confidence: bias.confidence,
      reason: bias.reason,
      recentEvents: bias.recentEvents,
      nextEvent: blackout.nextHighImpactEvent
    };
  }

  /**
   * Mock calendar data
   */
  getMockCalendar() {
    return {
      valid: true,
      events: [],
      highImpactEvents: [],
      source: 'mock',
      note: 'Using mock data - set FINNHUB_API_KEY for real data'
    };
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

export default EconomicCalendar;
