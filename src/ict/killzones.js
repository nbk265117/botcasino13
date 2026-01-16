/**
 * ICT Killzone Detection
 *
 * Killzones are specific time windows where institutional activity is highest
 * Trading ONLY during these windows significantly increases probability
 *
 * Primary Killzones (UTC):
 * - London Open: 07:00 - 10:00
 * - New York AM: 13:00 - 16:00
 * - New York PM: 18:00 - 20:00
 *
 * Silver Bullet Windows (highest probability micro-windows):
 * - London: 09:00 - 10:00
 * - NY AM: 14:00 - 15:00
 * - NY PM: 19:00 - 20:00
 */

import { CONFIG } from '../../config/settings.js';

export class KillzoneDetector {
  constructor() {
    this.killzones = CONFIG.KILLZONES;
  }

  /**
   * Parse time string to minutes since midnight
   */
  parseTime(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Get current time in UTC
   */
  getCurrentUTCTime() {
    const now = new Date();
    return {
      hours: now.getUTCHours(),
      minutes: now.getUTCMinutes(),
      totalMinutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
      dayOfWeek: now.getUTCDay(), // 0 = Sunday, 6 = Saturday
      date: now.toISOString().split('T')[0]
    };
  }

  /**
   * Check if current time is within a specific killzone
   */
  isInKillzone(killzoneName) {
    const kz = this.killzones[killzoneName];
    if (!kz || !kz.ENABLED) return false;

    const currentTime = this.getCurrentUTCTime();

    // Skip weekends
    if (currentTime.dayOfWeek === 0 || currentTime.dayOfWeek === 6) {
      return false;
    }

    const startMinutes = this.parseTime(kz.START);
    const endMinutes = this.parseTime(kz.END);

    return currentTime.totalMinutes >= startMinutes &&
           currentTime.totalMinutes <= endMinutes;
  }

  /**
   * Check if currently in ANY active killzone
   */
  isInAnyKillzone() {
    const killzoneNames = ['ASIA', 'LONDON', 'NEW_YORK_AM', 'NEW_YORK_PM'];

    for (const name of killzoneNames) {
      if (this.isInKillzone(name)) {
        return {
          active: true,
          killzone: name,
          description: this.killzones[name].DESCRIPTION
        };
      }
    }

    return { active: false, killzone: null };
  }

  /**
   * Check if in Silver Bullet window (highest probability)
   */
  isInSilverBullet() {
    const currentTime = this.getCurrentUTCTime();
    const silverBullets = this.killzones.SILVER_BULLET;

    // Skip weekends
    if (currentTime.dayOfWeek === 0 || currentTime.dayOfWeek === 6) {
      return { active: false };
    }

    for (const [name, window] of Object.entries(silverBullets)) {
      const startMinutes = this.parseTime(window.START);
      const endMinutes = this.parseTime(window.END);

      if (currentTime.totalMinutes >= startMinutes &&
          currentTime.totalMinutes <= endMinutes) {
        return {
          active: true,
          window: name,
          minutesRemaining: endMinutes - currentTime.totalMinutes
        };
      }
    }

    return { active: false };
  }

  /**
   * Get next killzone start time
   */
  getNextKillzone() {
    const currentTime = this.getCurrentUTCTime();
    const killzoneNames = ['LONDON', 'NEW_YORK_AM']; // Only enabled ones

    let nextKillzone = null;
    let minMinutesUntil = Infinity;

    for (const name of killzoneNames) {
      const kz = this.killzones[name];
      if (!kz.ENABLED) continue;

      const startMinutes = this.parseTime(kz.START);
      let minutesUntil = startMinutes - currentTime.totalMinutes;

      // If negative, it's tomorrow
      if (minutesUntil < 0) {
        minutesUntil += 24 * 60;
      }

      if (minutesUntil < minMinutesUntil) {
        minMinutesUntil = minutesUntil;
        nextKillzone = {
          name,
          startTime: kz.START,
          minutesUntil,
          hoursUntil: (minutesUntil / 60).toFixed(1)
        };
      }
    }

    return nextKillzone;
  }

  /**
   * Get session open time for Judas swing detection
   */
  getSessionOpenInfo() {
    const currentTime = this.getCurrentUTCTime();
    const sessions = {
      LONDON: { open: '07:00', name: 'London' },
      NEW_YORK: { open: '13:00', name: 'New York' }
    };

    for (const [key, session] of Object.entries(sessions)) {
      const openMinutes = this.parseTime(session.open);
      const minutesSinceOpen = currentTime.totalMinutes - openMinutes;

      // Within 30 minutes of session open
      if (minutesSinceOpen >= 0 && minutesSinceOpen <= 30) {
        return {
          withinSessionOpen: true,
          session: session.name,
          minutesSinceOpen,
          openTime: session.open
        };
      }
    }

    return { withinSessionOpen: false };
  }

  /**
   * Calculate killzone quality score
   * Higher score = better time to trade
   */
  getKillzoneQuality() {
    const inKillzone = this.isInAnyKillzone();
    const inSilverBullet = this.isInSilverBullet();
    const sessionOpen = this.getSessionOpenInfo();

    let score = 0;
    const factors = [];

    if (!inKillzone.active) {
      return {
        score: 0,
        tradeable: false,
        reason: 'Outside killzone',
        nextKillzone: this.getNextKillzone()
      };
    }

    // Base score for being in killzone
    score += 5;
    factors.push(`In ${inKillzone.killzone} killzone`);

    // Bonus for Silver Bullet
    if (inSilverBullet.active) {
      score += 3;
      factors.push(`Silver Bullet window (${inSilverBullet.window})`);
    }

    // Bonus for session open (Judas swing opportunity)
    if (sessionOpen.withinSessionOpen) {
      score += 2;
      factors.push(`Near ${sessionOpen.session} session open`);
    }

    // NY AM killzone is highest probability
    if (inKillzone.killzone === 'NEW_YORK_AM') {
      score += 1;
      factors.push('NY AM = highest probability');
    }

    return {
      score,
      maxScore: 11,
      tradeable: true,
      factors,
      inKillzone,
      inSilverBullet,
      sessionOpen
    };
  }

  /**
   * Should we skip trading today? (Weekends, holidays)
   */
  shouldSkipToday() {
    const currentTime = this.getCurrentUTCTime();

    // Skip weekends
    if (currentTime.dayOfWeek === 0 || currentTime.dayOfWeek === 6) {
      return {
        skip: true,
        reason: 'Weekend - no institutional activity'
      };
    }

    // Major holidays (simplified list)
    const holidays = [
      '2025-01-01', // New Year
      '2025-01-20', // MLK Day
      '2025-02-17', // Presidents Day
      '2025-04-18', // Good Friday
      '2025-05-26', // Memorial Day
      '2025-07-04', // Independence Day
      '2025-09-01', // Labor Day
      '2025-11-27', // Thanksgiving
      '2025-12-25', // Christmas
    ];

    if (holidays.includes(currentTime.date)) {
      return {
        skip: true,
        reason: 'Major holiday - reduced liquidity'
      };
    }

    return { skip: false };
  }

  /**
   * Get comprehensive trading window status
   */
  getTradingWindowStatus() {
    const skipCheck = this.shouldSkipToday();
    if (skipCheck.skip) {
      return {
        canTrade: false,
        ...skipCheck
      };
    }

    const quality = this.getKillzoneQuality();

    return {
      canTrade: quality.tradeable,
      quality,
      currentTime: this.getCurrentUTCTime(),
      recommendation: quality.tradeable
        ? `ACTIVE: ${quality.factors.join(', ')}`
        : `WAIT: ${quality.reason}`
    };
  }
}

export default KillzoneDetector;
