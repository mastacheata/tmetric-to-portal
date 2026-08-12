/**
 * Time utility functions for TMetric to Portal sync
 */

/**
 * Rounds decimal hours to the nearest 0.25h (15 minute) interval
 * and formats it with a German decimal comma (e.g. "1,75").
 *
 * @param {number} decimalHours - Hours spent in decimal (e.g. 1.73)
 * @returns {string} Formatted decimal hours string (e.g. "1,75")
 */
export function roundTo15Min(decimalHours) {
  if (typeof decimalHours !== 'number' || isNaN(decimalHours) || decimalHours <= 0) {
    return '0,25';
  }
  // Minimum 0.25 if tracked time is > 0
  const rounded = Math.max(0.25, Math.round(decimalHours * 4) / 4);
  return rounded.toFixed(2).replace('.', ',');
}

/**
 * Parses a duration in seconds or minutes to decimal hours.
 * 
 * @param {number} durationInSeconds 
 * @returns {number} Decimal hours
 */
export function secondsToDecimalHours(durationInSeconds) {
  if (!durationInSeconds || durationInSeconds < 0) return 0;
  return durationInSeconds / 3600;
}

/**
 * Formats a Date object or ISO string to flatpickr datetime format: "DD.MM.YYYY HH:mm"
 * 
 * @param {Date|string} dateInput 
 * @returns {string} Formatted datetime string e.g. "26.05.2026 08:00"
 */
export function formatDateFlatpickr(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Formats a Date object or ISO string to date-only format: "YYYY-MM-DD"
 * 
 * @param {Date|string} dateInput 
 * @returns {string} Formatted date string e.g. "2026-05-26"
 */
export function formatDateISO(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${year}-${month}-${day}`;
}

/**
 * Calculates start time, end time, and total break time for a Zeitabschnitt.
 * 
 * @param {Array<{startTime: string|Date, endTime: string|Date, duration?: number}>} entries 
 * @returns {{ startTimeStr: string, endTimeStr: string, breakTimeMins: number, totalSpanMins: number, totalWorkedMins: number } | null}
 */
export function calculateZeitabschnitt(entries) {
  if (!entries || entries.length === 0) return null;

  const validEntries = entries.filter(e => e.startTime && e.endTime);
  if (validEntries.length === 0) return null;

  const startDates = validEntries.map(e => new Date(e.startTime));
  const endDates = validEntries.map(e => new Date(e.endTime));

  const minStart = new Date(Math.min(...startDates));
  const maxEnd = new Date(Math.max(...endDates));

  const totalSpanMins = Math.round((maxEnd.getTime() - minStart.getTime()) / (1000 * 60));

  // Calculate total worked minutes across all entries
  let totalWorkedMins = 0;
  validEntries.forEach(e => {
    if (typeof e.duration === 'number') {
      totalWorkedMins += Math.round(e.duration / 60);
    } else {
      const s = new Date(e.startTime);
      const end = new Date(e.endTime);
      totalWorkedMins += Math.round((end.getTime() - s.getTime()) / (1000 * 60));
    }
  });

  const breakTimeMins = Math.max(0, totalSpanMins - totalWorkedMins);

  return {
    startTimeStr: formatDateFlatpickr(minStart),
    endTimeStr: formatDateFlatpickr(maxEnd),
    breakTimeMins,
    totalSpanMins,
    totalWorkedMins,
  };
}

/**
 * Returns an array of YYYY-MM-DD date strings for the past N days.
 * 
 * @param {number} count - Number of past days (e.g. 3)
 * @param {Date|string} [baseDateInput] - Reference end date (defaults to today)
 * @returns {string[]} Array of date strings ordered chronologically e.g. ["2026-08-11", "2026-08-12", "2026-08-13"]
 */
export function getPastDates(count = 3, baseDateInput = new Date()) {
  const dates = [];
  const baseDate = new Date(baseDateInput);
  
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - i);
    dates.push(formatDateISO(d));
  }
  
  return dates;
}
