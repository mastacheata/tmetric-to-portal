/**
 * TMetric REST API Client (v3)
 */

import { getTMetricToken, getTMetricUserId, setTMetricUserId, getTMetricAccountId, setTMetricAccountId } from '../storage/config.js';

const TMETRIC_BASE_URL = 'https://app.tmetric.com/api/v3';

/**
 * Helper to make HTTP requests using GM_xmlhttpRequest if available, or fetch as fallback.
 * Safely handles empty response bodies and HTTP status errors.
 */
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            const text = (response.responseText || '').trim();
            if (!text) {
              resolve(null);
              return;
            }
            try {
              const data = JSON.parse(text);
              resolve(data);
            } catch (e) {
              resolve(text);
            }
          } else {
            reject(new Error(`TMetric API error (HTTP ${response.status}): ${response.statusText || 'Request failed'}`));
          }
        },
        onerror: (err) => reject(new Error('Network error connecting to TMetric API')),
      });
    } else {
      fetch(options.url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.data,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`TMetric API error (HTTP ${res.status}): ${res.statusText}`);
          const text = (await res.text()).trim();
          if (!text) return null;
          try {
            return JSON.parse(text);
          } catch (e) {
            return text;
          }
        })
        .then(resolve)
        .catch(reject);
    }
  });
}

/**
 * Fetches user profile from TMetric API v3 to validate token and retrieve User ID & Account ID.
 */
export async function fetchTMetricUser(token) {
  const bearerToken = token || getTMetricToken();
  if (!bearerToken) throw new Error('TMetric API Token is not configured.');

  const data = await httpRequest({
    url: `${TMETRIC_BASE_URL}/user`,
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Accept': 'application/json',
    },
  });

  if (data) {
    if (data.id) setTMetricUserId(data.id);
    if (data.activeAccountId) setTMetricAccountId(data.activeAccountId);
  }
  return data;
}

/**
 * Fetches TMetric time entries for a given date string (YYYY-MM-DD).
 * 
 * @param {string} dateISO - Date string e.g. "2026-08-12"
 * @returns {Promise<Array>} Array of time entries
 */
export async function fetchTimeEntries(dateISO) {
  const token = getTMetricToken();
  if (!token) throw new Error('TMetric API Token is missing. Please configure it in settings.');

  let accountId = getTMetricAccountId();
  if (!accountId) {
    const user = await fetchTMetricUser(token);
    accountId = user.activeAccountId;
  }

  const startDate = `${dateISO}T00:00:00Z`;
  const endDate = `${dateISO}T23:59:59Z`;

  const url = `${TMETRIC_BASE_URL}/accounts/${accountId}/timeentries?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

  const entries = await httpRequest({
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!Array.isArray(entries)) return [];

  // Filter out running entries without endTime and compute durations
  return entries.map(entry => {
    let duration = entry.duration;
    if (typeof duration !== 'number' && entry.startTime && entry.endTime) {
      const s = new Date(entry.startTime).getTime();
      const e = new Date(entry.endTime).getTime();
      duration = Math.max(0, Math.round((e - s) / 1000));
    }
    return {
      ...entry,
      duration: duration || 0,
    };
  });
}

/**
 * Fetches TMetric time entries across a date range (startDateISO to endDateISO).
 * 
 * @param {string} startDateISO - e.g. "2026-08-11"
 * @param {string} endDateISO - e.g. "2026-08-13"
 * @returns {Promise<Array>} Array of time entries
 */
export async function fetchTimeEntriesForRange(startDateISO, endDateISO) {
  const token = getTMetricToken();
  if (!token) throw new Error('TMetric API Token is missing. Please configure it in settings.');

  let accountId = getTMetricAccountId();
  if (!accountId) {
    const user = await fetchTMetricUser(token);
    accountId = user.activeAccountId;
  }

  const start = `${startDateISO}T00:00:00Z`;
  const end = `${endDateISO}T23:59:59Z`;

  const url = `${TMETRIC_BASE_URL}/accounts/${accountId}/timeentries?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;

  const entries = await httpRequest({
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    let duration = entry.duration;
    if (typeof duration !== 'number' && entry.startTime && entry.endTime) {
      const s = new Date(entry.startTime).getTime();
      const e = new Date(entry.endTime).getTime();
      duration = Math.max(0, Math.round((e - s) / 1000));
    }
    return {
      ...entry,
      duration: duration || 0,
    };
  });
}

/**
 * Fetches existing TMetric projects for the active account.
 * 
 * @returns {Promise<Array<{id: number, name: string, code?: string, client?: {id: number, name: string}}>>}
 */
export async function fetchTMetricProjects() {
  const token = getTMetricToken();
  if (!token) throw new Error('TMetric Token missing');
  let accountId = getTMetricAccountId();
  if (!accountId) {
    const user = await fetchTMetricUser(token);
    accountId = user.activeAccountId;
  }

  const url = `${TMETRIC_BASE_URL}/accounts/${accountId}/timeentries/projects`;
  const projects = await httpRequest({
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  return Array.isArray(projects) ? projects : [];
}

/**
 * Fetches existing TMetric clients for the active account.
 * 
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function fetchTMetricClients() {
  const token = getTMetricToken();
  if (!token) throw new Error('TMetric Token missing');
  let accountId = getTMetricAccountId();
  if (!accountId) {
    const user = await fetchTMetricUser(token);
    accountId = user.activeAccountId;
  }

  const url = `${TMETRIC_BASE_URL}/accounts/${accountId}/clients`;
  const clients = await httpRequest({
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  return Array.isArray(clients) ? clients : [];
}

/**
 * Creates a new project in TMetric.
 * 
 * @param {{ name: string, code?: string, clientId?: number|string }} projectData 
 * @returns {Promise<object>} Created project object
 */
export async function createTMetricProject(projectData) {
  const token = getTMetricToken();
  if (!token) throw new Error('TMetric Token missing');
  let accountId = getTMetricAccountId();
  if (!accountId) {
    const user = await fetchTMetricUser(token);
    accountId = user.activeAccountId;
  }

  const payload = {
    name: projectData.name,
  };
  if (projectData.code && projectData.code.trim()) {
    const codeVal = projectData.code.trim();
    payload.code = codeVal;
    payload.projectCode = codeVal;
  }
  if (projectData.clientId) {
    const clientIdNum = parseInt(projectData.clientId, 10);
    payload.client = { id: clientIdNum };
    payload.clientId = clientIdNum;
  }

  const url = `${TMETRIC_BASE_URL}/accounts/${accountId}/projects`;
  return await httpRequest({
    method: 'POST',
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    data: JSON.stringify(payload),
  });
}
