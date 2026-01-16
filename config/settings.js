/**
 * BOT CASINO 13 - Configuration
 * ICT-Based Polymarket BTC Direction Trading System
 *
 * OBJECTIVE: 13 consecutive wins ($12 → $98,304)
 * STRATEGY: 100% capital per trade, highest win-rate ICT setups only
 */

export const CONFIG = {
  // ═══════════════════════════════════════════════════════════════════
  // CHALLENGE PARAMETERS
  // ═══════════════════════════════════════════════════════════════════
  CHALLENGE: {
    STARTING_CAPITAL: 12,
    TARGET_CAPITAL: 98304,
    REQUIRED_WINS: 13,
    POSITION_SIZE_PERCENT: 100, // ALL-IN, non-negotiable
    MAX_TRADES_PER_DAY: 1,      // Unless A+ confluence
    ALLOW_SECOND_TRADE_IF_A_PLUS: true,
  },

  // ═══════════════════════════════════════════════════════════════════
  // KILLZONE DEFINITIONS (UTC)
  // These are the ONLY windows where institutional activity occurs
  // ═══════════════════════════════════════════════════════════════════
  KILLZONES: {
    ASIA: {
      START: '00:00',
      END: '04:00',
      ENABLED: false,  // Lower probability, skip for challenge
      DESCRIPTION: 'Asian session - accumulation/distribution'
    },
    LONDON: {
      START: '07:00',
      END: '10:00',
      ENABLED: true,
      DESCRIPTION: 'London Open - major liquidity grab zone'
    },
    NEW_YORK_AM: {
      START: '13:00',
      END: '16:00',
      ENABLED: true,
      DESCRIPTION: 'NY AM Session - highest probability reversal zone'
    },
    NEW_YORK_PM: {
      START: '18:00',
      END: '20:00',
      ENABLED: false,  // Lower liquidity, skip for challenge
      DESCRIPTION: 'NY PM Session - continuation/distribution'
    },
    // Silver Bullet windows - highest probability micro windows
    SILVER_BULLET: {
      LONDON: { START: '09:00', END: '10:00' },
      NY_AM: { START: '14:00', END: '15:00' },
      NY_PM: { START: '19:00', END: '20:00' },
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // ICT CONCEPTS PARAMETERS
  // ═══════════════════════════════════════════════════════════════════
  ICT: {
    // Fair Value Gap (FVG) Settings
    FVG: {
      MIN_SIZE_PERCENT: 0.10,     // RELAXED: Min FVG size (was 0.15)
      MAX_SIZE_PERCENT: 2.0,      // RELAXED: Max FVG size (was 1.5)
      LOOKBACK_CANDLES: 30,       // RELAXED: Lookback (was 50)
      REQUIRE_DISPLACEMENT: false, // RELAXED: FVG doesn't require displacement
      DISPLACEMENT_MIN_SIZE: 0.15, // RELAXED: Min displacement size (was 0.2)
    },

    // Order Block Settings
    ORDER_BLOCK: {
      LOOKBACK_CANDLES: 20,
      MIN_IMBALANCE_RATIO: 1.5,   // Body to wick ratio
      REQUIRE_BREAK_OF_STRUCTURE: true,
    },

    // Liquidity Settings
    LIQUIDITY: {
      EQUAL_HIGHS_LOWS_TOLERANCE: 0.08,  // RELAXED: 0.08% tolerance for "equal" (was 0.05)
      SESSION_LOOKBACK_HOURS: 24,
      SWEEP_CONFIRMATION_CANDLES: 2,     // RELAXED: 2 candles to confirm (was 3)
      MIN_LIQUIDITY_POOL_TOUCHES: 2,     // Min touches to be valid pool
      SWEEP_REQUIRED: false,             // Sweep as bonus
    },

    // Premium/Discount Zones
    PREMIUM_DISCOUNT: {
      PREMIUM_THRESHOLD: 0.618,   // Above 61.8% = premium
      DISCOUNT_THRESHOLD: 0.382,  // Below 38.2% = discount
      EQUILIBRIUM_BUFFER: 0.05,   // 5% buffer around 50%
    },

    // Market Structure
    STRUCTURE: {
      // Swing lookback varies by timeframe for realistic detection
      SWING_LOOKBACK: 5,          // Default for 5m/15m candles
      SWING_LOOKBACK_HTF: 3,      // For 4H/1D candles (fewer candles available)
      BOS_CONFIRMATION_CANDLES: 2, // Candles to confirm BOS
      CHOCH_REQUIRES_FVG: true,   // CHoCH must have FVG
    },

    // SMT Divergence (BTC vs ETH)
    SMT: {
      ENABLED: true,
      CORRELATION_THRESHOLD: 0.85, // Min correlation for valid SMT
      DIVERGENCE_LOOKBACK: 20,
      MIN_DIVERGENCE_PERCENT: 0.5,
    },

    // MMXM (Market Maker Model)
    MMXM: {
      PHASES: ['ACCUMULATION', 'MANIPULATION', 'DISTRIBUTION', 'REVERSION'],
      MIN_MANIPULATION_PERCENT: 0.3,
      REVERSION_TARGET_FIB: 0.5,  // Target 50% of range
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // HIGHER TIMEFRAME BIAS
  // ═══════════════════════════════════════════════════════════════════
  HTF_BIAS: {
    TIMEFRAMES: ['4h', '1d'],
    REQUIRE_ALL_ALIGNED: false,   // At least 1 of 2 must have clear bias
    MIN_ALIGNED_COUNT: 0,         // RELAXED: Accept even if no clear HTF bias
    ALLOW_NEUTRAL_BIAS: true,     // NEW: Trade even with neutral HTF (use LTF direction)

    // Bias determination factors
    FACTORS: {
      MARKET_STRUCTURE: 0.4,      // Weight: HTF swing structure
      ORDER_FLOW: 0.3,            // Weight: HTF OB/FVG direction
      LIQUIDITY_POOLS: 0.3,       // Weight: Where is liquidity?
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // TRADE FILTERS (MANDATORY)
  // ═══════════════════════════════════════════════════════════════════
  FILTERS: {
    // News Events - NO TRADE within these windows
    NEWS: {
      ENABLED: true,
      BLACKOUT_MINUTES_BEFORE: 60,
      BLACKOUT_MINUTES_AFTER: 30,
      HIGH_IMPACT_EVENTS: [
        'FOMC',
        'CPI',
        'NFP',
        'PPI',
        'UNEMPLOYMENT',
        'GDP',
        'RETAIL_SALES',
        'FED_CHAIR_SPEECH'
      ]
    },

    // Volatility Filter
    VOLATILITY: {
      MIN_ATR_PERCENT: 0.5,       // Too low = no edge
      MAX_ATR_PERCENT: 3.0,       // Too high = unpredictable
      ATR_PERIOD: 14,
    },

    // Spread/Liquidity Filter
    SPREAD: {
      MAX_SPREAD_PERCENT: 0.1,    // Skip if spread too wide
    },

    // Time Decay - Polymarket specific
    POLYMARKET: {
      MIN_HOURS_BEFORE_EXPIRY: 4,  // Don't enter too close to expiry
      MAX_HOURS_BEFORE_EXPIRY: 20, // Don't enter too early
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // ENTRY MODELS (Pick ONE per trade)
  // ═══════════════════════════════════════════════════════════════════
  ENTRY_MODELS: {
    // MMXM ONLY MODE: Only trade MMXM setups (75% win rate vs 50% FVG)
    MMXM_ONLY: false,  // Set to false to allow both FVG and MMXM

    // Model 1: FVG Entry after Displacement
    FVG_DISPLACEMENT: {
      ENABLED: true,
      PRIORITY: 1,
      DESCRIPTION: 'Enter on FVG after displacement leg',
      WIN_RATE_ESTIMATE: 0.68,
      REQUIREMENTS: [
        'HTF_BIAS_ALIGNED',
        'KILLZONE_ACTIVE',
        'LIQUIDITY_SWEPT',
        'DISPLACEMENT_CONFIRMED',
        'FVG_FORMED',
        'PRICE_IN_DISCOUNT_OR_PREMIUM'
      ]
    },

    // Model 2: MMXM - Market Maker Model
    MMXM: {
      ENABLED: true,
      PRIORITY: 2,
      DESCRIPTION: 'Full market maker cycle completion',
      WIN_RATE_ESTIMATE: 0.72,
      REQUIREMENTS: [
        'HTF_BIAS_ALIGNED',
        'ACCUMULATION_IDENTIFIED',
        'MANIPULATION_COMPLETE',
        'SMT_DIVERGENCE_PRESENT',
        'KILLZONE_ACTIVE'
      ]
    },

    // Model 3: Judas Swing
    JUDAS_SWING: {
      ENABLED: true,
      PRIORITY: 3,
      DESCRIPTION: 'Fake move at session open to trap traders',
      WIN_RATE_ESTIMATE: 0.65,
      REQUIREMENTS: [
        'SESSION_OPEN_WITHIN_30MIN',
        'MOVE_AGAINST_HTF_BIAS',
        'LIQUIDITY_POOL_HIT',
        'REVERSAL_STRUCTURE_FORMING'
      ]
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // CONFLUENCE SCORING
  // ═══════════════════════════════════════════════════════════════════
  CONFLUENCE: {
    MIN_SCORE_TO_TRADE: 7,        // Out of ~15 (increased with new factors)
    A_PLUS_SCORE: 10,             // Allows second daily trade

    FACTORS: {
      // ICT Technical Factors
      HTF_BIAS_ALIGNED: 2,
      KILLZONE_ACTIVE: 1,
      LIQUIDITY_SWEPT: 2,
      FVG_PRESENT: 1,
      ORDER_BLOCK_PRESENT: 1,
      SMT_DIVERGENCE: 1.5,
      PREMIUM_DISCOUNT_ZONE: 1,
      NEWS_CLEAR: 0.5,
      // NEW: External Data Factors
      NEWS_SENTIMENT_ALIGNED: 1.5,  // LunarCrush + CryptoNews sentiment
      ETF_FLOWS_ALIGNED: 2.0,       // BTC ETF inflows/outflows
      ECONOMIC_BIAS_ALIGNED: 1.0,   // CPI/FOMC/NFP interpretation
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // POLYMARKET SPECIFIC
  // ═══════════════════════════════════════════════════════════════════
  POLYMARKET: {
    API_URL: 'https://clob.polymarket.com',
    GAMMA_URL: 'https://gamma-api.polymarket.com',

    // Market types we trade
    MARKET_TYPES: {
      DAILY_UP_DOWN: true,        // "Bitcoin Up or Down on [Date]?"
      PRICE_ABOVE_X: false,       // "Will BTC be above $X?" - harder to predict
      HOURLY: false,              // Too noisy
    },

    // Outcome mapping
    OUTCOMES: {
      UP: 'Yes',    // If we predict UP, buy YES
      DOWN: 'No',   // If we predict DOWN, buy NO (or sell YES)
    },

    // Price limits for entry
    MIN_ODDS_PRICE: 0.35,         // Don't buy if already >65c (poor R:R)
    MAX_ODDS_PRICE: 0.65,         // Don't buy if <35c (market disagrees strongly)
    IDEAL_ODDS_RANGE: [0.45, 0.55], // Best entry - coin flip pricing
  },

  // ═══════════════════════════════════════════════════════════════════
  // EXECUTION
  // ═══════════════════════════════════════════════════════════════════
  EXECUTION: {
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 1000,
    SLIPPAGE_TOLERANCE: 0.02,     // 2% max slippage
    GAS_MULTIPLIER: 1.2,          // 20% above estimated gas
  },

  // ═══════════════════════════════════════════════════════════════════
  // BACKTEST SIMULATION PARAMETERS
  // These make backtest more realistic by simulating execution costs
  // ═══════════════════════════════════════════════════════════════════
  BACKTEST: {
    // Decision timing
    DECISION_HOUR_UTC: 15,        // 3PM UTC - when to make daily decision

    // Execution simulation
    SLIPPAGE: {
      ENABLED: true,
      BASE_SLIPPAGE_PERCENT: 0.5,  // 0.5% base slippage on Polymarket
      VARIABLE_SLIPPAGE: true,     // Add random component
      MAX_SLIPPAGE_PERCENT: 2.0,   // Maximum slippage
    },

    // Fees simulation
    FEES: {
      ENABLED: true,
      POLYMARKET_FEE_PERCENT: 0,   // Polymarket has 0 trading fees
      GAS_FEE_USD: 0.50,           // ~$0.50 gas per trade on Polygon
    },

    // Market conditions simulation
    MARKET_CONDITIONS: {
      // Sometimes market odds are unfavorable
      REJECT_BAD_ODDS: true,
      MIN_ODDS_RATIO: 0.40,        // Don't buy if price > 60c (implied >60% probability)
      MAX_ODDS_RATIO: 0.60,        // Don't buy if price < 40c (market strongly disagrees)
    },

    // Randomization for robustness testing
    RANDOMIZATION: {
      ENABLED: false,              // Add random noise to simulate real conditions
      NOISE_PERCENT: 5,            // ±5% noise on signals
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // DATA SOURCES
  // ═══════════════════════════════════════════════════════════════════
  DATA: {
    EXCHANGE: 'binance',
    SYMBOLS: {
      BTC: 'BTC/USDT',
      ETH: 'ETH/USDT',  // For SMT divergence
    },
    TIMEFRAMES: ['5m', '15m', '1h', '4h', '1d'],
    CANDLE_LIMIT: 500,
  },

  // ═══════════════════════════════════════════════════════════════════
  // EXTERNAL DATA SOURCES (News, ETF Flows, Economic Calendar)
  // ═══════════════════════════════════════════════════════════════════
  DATA_SOURCES: {
    // News Sentiment Analysis
    NEWS_SENTIMENT: {
      ENABLED: true,
      WEIGHT_IN_CONFLUENCE: 1.5,  // Add 1.5 points if aligned
      // Thresholds for directional bias
      BULLISH_THRESHOLD: 30,      // Score >= 30 = BULLISH
      BEARISH_THRESHOLD: -30,     // Score <= -30 = BEARISH
      // Sources
      USE_LUNARCRUSH: true,
      USE_CRYPTONEWS: true,
      USE_FEAR_GREED: true,
    },

    // Bitcoin ETF Flows
    ETF_FLOWS: {
      ENABLED: true,
      WEIGHT_IN_CONFLUENCE: 2.0,  // ETF flows are highly predictive
      // Thresholds (in USD)
      STRONG_INFLOW_THRESHOLD: 500_000_000,   // $500M = strong bullish
      STRONG_OUTFLOW_THRESHOLD: -500_000_000, // -$500M = strong bearish
      MODERATE_THRESHOLD: 100_000_000,        // $100M = moderate signal
      // Block trade if ETF flow strongly contradicts
      BLOCK_ON_STRONG_DISAGREEMENT: true,
    },

    // Economic Calendar
    ECONOMIC_CALENDAR: {
      ENABLED: true,
      WEIGHT_IN_CONFLUENCE: 1.0,
      // Use economic data for directional bias
      USE_FOR_BIAS: true,
      // Block trade during high-impact events (handled by newsFilter)
      BLACKOUT_ENABLED: true,
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // LOGGING
  // ═══════════════════════════════════════════════════════════════════
  LOGGING: {
    LEVEL: 'debug',
    FILE_PATH: './logs/bot.log',
    CONSOLE: true,
    LOG_EVERY_ANALYSIS: true,
  }
};

export default CONFIG;
