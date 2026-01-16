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
      MIN_SIZE_PERCENT: 0.15,     // Minimum FVG size as % of price
      MAX_SIZE_PERCENT: 1.5,      // Maximum (too large = manipulation)
      LOOKBACK_CANDLES: 50,       // How far back to find FVGs
      REQUIRE_DISPLACEMENT: true, // FVG must follow displacement
      DISPLACEMENT_MIN_SIZE: 0.3, // Min displacement candle size %
    },

    // Order Block Settings
    ORDER_BLOCK: {
      LOOKBACK_CANDLES: 20,
      MIN_IMBALANCE_RATIO: 1.5,   // Body to wick ratio
      REQUIRE_BREAK_OF_STRUCTURE: true,
    },

    // Liquidity Settings
    LIQUIDITY: {
      EQUAL_HIGHS_LOWS_TOLERANCE: 0.05,  // % tolerance for "equal"
      SESSION_LOOKBACK_HOURS: 24,
      SWEEP_CONFIRMATION_CANDLES: 3,     // Candles to confirm sweep
      MIN_LIQUIDITY_POOL_TOUCHES: 2,     // Min touches to be valid pool
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
    MIN_ALIGNED_COUNT: 1,         // Relaxed: just need 1 TF with clear bias

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
    MIN_SCORE_TO_TRADE: 7,        // Out of 10
    A_PLUS_SCORE: 9,              // Allows second daily trade

    FACTORS: {
      HTF_BIAS_ALIGNED: 2,
      KILLZONE_ACTIVE: 1,
      LIQUIDITY_SWEPT: 2,
      FVG_PRESENT: 1,
      ORDER_BLOCK_PRESENT: 1,
      SMT_DIVERGENCE: 1.5,
      PREMIUM_DISCOUNT_ZONE: 1,
      NEWS_CLEAR: 0.5,
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
