/**
 * News Filter
 *
 * Filters out trading during high-impact economic events
 * These events cause unpredictable volatility that invalidates ICT logic
 *
 * Events to avoid:
 * - FOMC (Federal Reserve decisions)
 * - CPI (Consumer Price Index)
 * - NFP (Non-Farm Payrolls)
 * - PPI (Producer Price Index)
 * - Unemployment data
 * - GDP releases
 * - Fed Chair speeches
 */

import axios from 'axios';
import { CONFIG } from '../../config/settings.js';

export class NewsFilter {
  constructor() {
    this.config = CONFIG.FILTERS.NEWS;
    this.cachedEvents = null;
    this.cacheExpiry = 0;
    this.cacheLifetime = 3600000; // 1 hour

    // Static list of known high-impact events (2025)
    // In production, this should be fetched from a news API
    this.scheduledEvents = this.getScheduledEvents();
  }

  /**
   * Known high-impact economic events for 2025
   * Format: { date: 'YYYY-MM-DD', time: 'HH:MM' (UTC), event: string }
   */
  getScheduledEvents() {
    return [
      // January 2025
      { date: '2025-01-10', time: '13:30', event: 'NFP' },
      { date: '2025-01-14', time: '13:30', event: 'CPI' },
      { date: '2025-01-15', time: '13:30', event: 'PPI' },
      { date: '2025-01-29', time: '19:00', event: 'FOMC' },

      // February 2025
      { date: '2025-02-07', time: '13:30', event: 'NFP' },
      { date: '2025-02-12', time: '13:30', event: 'CPI' },
      { date: '2025-02-13', time: '13:30', event: 'PPI' },

      // March 2025
      { date: '2025-03-07', time: '13:30', event: 'NFP' },
      { date: '2025-03-12', time: '13:30', event: 'CPI' },
      { date: '2025-03-13', time: '13:30', event: 'PPI' },
      { date: '2025-03-19', time: '18:00', event: 'FOMC' },

      // April 2025
      { date: '2025-04-04', time: '13:30', event: 'NFP' },
      { date: '2025-04-10', time: '13:30', event: 'CPI' },
      { date: '2025-04-11', time: '13:30', event: 'PPI' },

      // May 2025
      { date: '2025-05-02', time: '13:30', event: 'NFP' },
      { date: '2025-05-07', time: '18:00', event: 'FOMC' },
      { date: '2025-05-13', time: '13:30', event: 'CPI' },
      { date: '2025-05-15', time: '13:30', event: 'PPI' },

      // June 2025
      { date: '2025-06-06', time: '13:30', event: 'NFP' },
      { date: '2025-06-11', time: '13:30', event: 'CPI' },
      { date: '2025-06-12', time: '13:30', event: 'PPI' },
      { date: '2025-06-18', time: '18:00', event: 'FOMC' },

      // July 2025
      { date: '2025-07-03', time: '13:30', event: 'NFP' },
      { date: '2025-07-10', time: '13:30', event: 'CPI' },
      { date: '2025-07-11', time: '13:30', event: 'PPI' },
      { date: '2025-07-30', time: '18:00', event: 'FOMC' },

      // August 2025
      { date: '2025-08-01', time: '13:30', event: 'NFP' },
      { date: '2025-08-13', time: '13:30', event: 'CPI' },
      { date: '2025-08-14', time: '13:30', event: 'PPI' },

      // September 2025
      { date: '2025-09-05', time: '13:30', event: 'NFP' },
      { date: '2025-09-10', time: '13:30', event: 'CPI' },
      { date: '2025-09-11', time: '13:30', event: 'PPI' },
      { date: '2025-09-17', time: '18:00', event: 'FOMC' },

      // October 2025
      { date: '2025-10-03', time: '13:30', event: 'NFP' },
      { date: '2025-10-10', time: '13:30', event: 'CPI' },
      { date: '2025-10-14', time: '13:30', event: 'PPI' },

      // November 2025
      { date: '2025-11-07', time: '13:30', event: 'NFP' },
      { date: '2025-11-05', time: '19:00', event: 'FOMC' },
      { date: '2025-11-13', time: '13:30', event: 'CPI' },
      { date: '2025-11-14', time: '13:30', event: 'PPI' },

      // December 2025
      { date: '2025-12-05', time: '13:30', event: 'NFP' },
      { date: '2025-12-10', time: '13:30', event: 'CPI' },
      { date: '2025-12-11', time: '13:30', event: 'PPI' },
      { date: '2025-12-17', time: '19:00', event: 'FOMC' },
    ];
  }

  /**
   * Parse event datetime to timestamp
   */
  parseEventTime(event) {
    const [hours, minutes] = event.time.split(':').map(Number);
    const date = new Date(event.date);
    date.setUTCHours(hours, minutes, 0, 0);
    return date.getTime();
  }

  /**
   * Check if currently in news blackout period
   */
  async checkNewsBlackout() {
    const now = Date.now();
    const blackoutBefore = this.config.BLACKOUT_MINUTES_BEFORE * 60 * 1000;
    const blackoutAfter = this.config.BLACKOUT_MINUTES_AFTER * 60 * 1000;

    for (const event of this.scheduledEvents) {
      if (!this.config.HIGH_IMPACT_EVENTS.includes(event.event)) {
        continue;
      }

      const eventTime = this.parseEventTime(event);
      const blackoutStart = eventTime - blackoutBefore;
      const blackoutEnd = eventTime + blackoutAfter;

      if (now >= blackoutStart && now <= blackoutEnd) {
        const minutesUntil = Math.round((eventTime - now) / 60000);

        return {
          blackout: true,
          event: event.event,
          eventTime: new Date(eventTime).toISOString(),
          minutesUntil: minutesUntil,
          reason: minutesUntil > 0
            ? `${event.event} in ${minutesUntil} minutes`
            : `${event.event} just released (${Math.abs(minutesUntil)} min ago)`
        };
      }
    }

    // Check for upcoming events today
    const upcomingToday = this.getUpcomingEventsToday();

    return {
      blackout: false,
      upcomingEvents: upcomingToday
    };
  }

  /**
   * Get upcoming high-impact events for today
   */
  getUpcomingEventsToday() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    return this.scheduledEvents
      .filter(event => {
        return event.date === today &&
               this.config.HIGH_IMPACT_EVENTS.includes(event.event) &&
               this.parseEventTime(event) > now.getTime();
      })
      .map(event => ({
        event: event.event,
        time: event.time,
        minutesUntil: Math.round((this.parseEventTime(event) - now.getTime()) / 60000)
      }));
  }

  /**
   * Get next high-impact event
   */
  getNextEvent() {
    const now = Date.now();

    const futureEvents = this.scheduledEvents
      .filter(event => {
        return this.config.HIGH_IMPACT_EVENTS.includes(event.event) &&
               this.parseEventTime(event) > now;
      })
      .sort((a, b) => this.parseEventTime(a) - this.parseEventTime(b));

    if (futureEvents.length === 0) {
      return null;
    }

    const next = futureEvents[0];
    return {
      event: next.event,
      date: next.date,
      time: next.time,
      hoursUntil: ((this.parseEventTime(next) - now) / 3600000).toFixed(1)
    };
  }

  /**
   * Check if a specific date/time is safe to trade
   */
  isSafeToTrade(timestamp) {
    const checkTime = new Date(timestamp).getTime();
    const blackoutBefore = this.config.BLACKOUT_MINUTES_BEFORE * 60 * 1000;
    const blackoutAfter = this.config.BLACKOUT_MINUTES_AFTER * 60 * 1000;

    for (const event of this.scheduledEvents) {
      if (!this.config.HIGH_IMPACT_EVENTS.includes(event.event)) {
        continue;
      }

      const eventTime = this.parseEventTime(event);
      const blackoutStart = eventTime - blackoutBefore;
      const blackoutEnd = eventTime + blackoutAfter;

      if (checkTime >= blackoutStart && checkTime <= blackoutEnd) {
        return {
          safe: false,
          conflictingEvent: event.event,
          eventTime: new Date(eventTime).toISOString()
        };
      }
    }

    return { safe: true };
  }

  /**
   * Get trading calendar for the week
   */
  getWeeklyCalendar() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay());
    weekStart.setUTCHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    return this.scheduledEvents
      .filter(event => {
        const eventTime = this.parseEventTime(event);
        return eventTime >= weekStart.getTime() &&
               eventTime < weekEnd.getTime() &&
               this.config.HIGH_IMPACT_EVENTS.includes(event.event);
      })
      .map(event => ({
        ...event,
        dayOfWeek: new Date(event.date).toLocaleDateString('en-US', { weekday: 'long' })
      }));
  }
}

export default NewsFilter;
