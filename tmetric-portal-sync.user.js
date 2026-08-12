// ==UserScript==
// @name         Beyonder Portal <-> TMetric Sync
// @namespace    https://portal.beyonder.de/
// @version      1.2.1
// @description  Automatically import TMetric time entries into Beyonder Portal & sync assigned Portal projects to TMetric
// @author       Beyonder Team
// @match        https://portal.beyonder.de/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      app.tmetric.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // --- 1. STORAGE UTILS ---
  const STORAGE_KEYS = {
    TMETRIC_TOKEN: 'tmetric_portal_sync_token',
    USER_ID: 'tmetric_portal_sync_user_id',
    ACCOUNT_ID: 'tmetric_portal_sync_account_id',
    PROJECT_MAPPINGS: 'tmetric_portal_sync_project_mappings',
  };

  function getValue(key, defaultValue = null) {
    try {
      if (typeof GM_getValue !== 'undefined') return GM_getValue(key, defaultValue);
    } catch (e) {}
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  function setValue(key, value) {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(key, value);
        return;
      }
    } catch (e) {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function getTMetricToken() { return getValue(STORAGE_KEYS.TMETRIC_TOKEN, ''); }
  function setTMetricToken(t) { setValue(STORAGE_KEYS.TMETRIC_TOKEN, t ? t.trim() : ''); }
  function getTMetricUserId() { return getValue(STORAGE_KEYS.USER_ID, ''); }
  function setTMetricUserId(id) { setValue(STORAGE_KEYS.USER_ID, id ? String(id) : ''); }
  function getTMetricAccountId() { return getValue(STORAGE_KEYS.ACCOUNT_ID, ''); }
  function setTMetricAccountId(id) { setValue(STORAGE_KEYS.ACCOUNT_ID, id ? String(id) : ''); }
  function getProjectMappings() { return getValue(STORAGE_KEYS.PROJECT_MAPPINGS, {}); }
  function saveProjectMapping(tmetricId, portalId) {
    const mappings = getProjectMappings();
    mappings[tmetricId] = portalId;
    setValue(STORAGE_KEYS.PROJECT_MAPPINGS, mappings);
  }


  // --- 2. TIME UTILS ---
  function roundTo15Min(decimalHours) {
    if (typeof decimalHours !== 'number' || isNaN(decimalHours) || decimalHours <= 0) return '0,25';
    const rounded = Math.max(0.25, Math.round(decimalHours * 4) / 4);
    return rounded.toFixed(2).replace('.', ',');
  }

  function secondsToDecimalHours(sec) {
    return (!sec || sec < 0) ? 0 : sec / 3600;
  }

  function formatDateFlatpickr(dateInput) {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  }

  function formatDateISO(dateInput) {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  }

  function getPastDates(count = 3, baseDateInput = new Date()) {
    const dates = [];
    const baseDate = new Date(baseDateInput);
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      dates.push(formatDateISO(d));
    }
    return dates;
  }

  function calculateZeitabschnitt(entries) {
    if (!entries || entries.length === 0) return null;
    const valid = entries.filter(e => e.startTime && e.endTime);
    if (valid.length === 0) return null;

    const starts = valid.map(e => new Date(e.startTime));
    const ends = valid.map(e => new Date(e.endTime));
    const minStart = new Date(Math.min(...starts));
    const maxEnd = new Date(Math.max(...ends));

    const totalSpanMins = Math.round((maxEnd.getTime() - minStart.getTime()) / (1000 * 60));
    let totalWorkedMins = 0;
    valid.forEach(e => {
      if (typeof e.duration === 'number') {
        totalWorkedMins += Math.round(e.duration / 60);
      } else {
        totalWorkedMins += Math.round((new Date(e.endTime) - new Date(e.startTime)) / (1000 * 60));
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


  // --- 3. MATCHING & PARSING ---
  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\säöüß-]/g, ' ')
      .replace(/\b(gmbh|co|kg|ag|de|ev|inc|ltd|support|interim|umsetzung|weiterentwicklung)\b/gi, '')
      .trim().split(/\s+/).filter(w => w.length > 1);
  }

  function calculateSimilarity(str1, str2) {
    const t1 = new Set(tokenize(str1));
    const t2 = new Set(tokenize(str2));
    if (t1.size === 0 || t2.size === 0) return 0;
    let inter = 0;
    for (const token of t1) {
      if (t2.has(token)) inter++;
      else {
        for (const token2 of t2) {
          if (token.length > 3 && token2.length > 3 && (token.includes(token2) || token2.includes(token))) {
            inter += 0.5;
            break;
          }
        }
      }
    }
    const union = t1.size + t2.size - inter;
    return union > 0 ? inter / union : 0;
  }

  function matchProject(tmetricName, portalProjects, savedMappings = {}, tmetricId = '') {
    if (!portalProjects || portalProjects.length === 0) return { bestMatch: null, score: 0, candidates: [] };
    if (tmetricId && savedMappings[tmetricId]) {
      const match = portalProjects.find(p => String(p.id) === String(savedMappings[tmetricId]));
      if (match) return { bestMatch: match, score: 1.0, candidates: [{ project: match, score: 1.0 }] };
    }
    if (!tmetricName) return { bestMatch: null, score: 0, candidates: [] };

    const candidates = portalProjects
      .map(p => ({ project: p, score: calculateSimilarity(tmetricName, p.name) }))
      .sort((a, b) => b.score - a.score);

    const bestMatch = candidates.length > 0 && candidates[0].score > 0.15 ? candidates[0].project : null;
    return { bestMatch, score: candidates.length > 0 ? candidates[0].score : 0, candidates };
  }

  function parseTicketAndTitle(entry) {
    const taskName = entry.task?.name || '';
    const taskIssueId = entry.task?.issueId || entry.task?.externalLink?.issueId || entry.task?.externalLink?.caption || '';
    const note = entry.note || entry.description || '';
    const fullText = (taskName ? `${taskName} ${note}` : note).trim();

    let ticketId = taskIssueId ? String(taskIssueId).replace(/^#/, '') : '';
    let cleanText = fullText;

    const prefixRegex = /^(?:#([a-zA-Z0-9]+(?:-[0-9]+)?)|\[([a-zA-Z0-9-]+)\]|([a-zA-Z]+-[0-9]+))\s*[:|-]?\s*(.*)$/;
    const match = cleanText.match(prefixRegex);

    if (match) {
      if (!ticketId) ticketId = match[1] || match[2] || match[3] || '';
      cleanText = (match[4] || '').trim();
    }

    if (ticketId && cleanText.toLowerCase().startsWith(ticketId.toLowerCase())) {
      cleanText = cleanText.substring(ticketId.length).replace(/^[:|-]\s*/, '').trim();
    }

    const title = cleanText.substring(0, 100).trim() || taskName || note || 'Arbeitszeit';
    return { ticketId, title };
  }

  function parseProfileProjectName(rawText) {
    if (!rawText) return { name: '', role: '' };
    const trimmed = rawText.trim();
    const match = trimmed.match(/^(.*?)(?:\s*\((.*)\))?$/);
    if (match && match[2]) {
      return { name: match[1].trim(), role: match[2].trim() };
    }
    return { name: trimmed, role: '' };
  }

  function matchBookingTag(entryInfo, availableTags) {
    if (!availableTags || availableTags.length === 0) return '';
    const { ticketId, tags = [], note = '' } = entryInfo;
    const tagNames = tags.map(t => (typeof t === 'string' ? t : (t?.name || '')));

    if (ticketId) {
      const match = availableTags.find(t => t.name.includes('#[TICKET-ID]') || t.name.toLowerCase().includes('ticket') || t.name.includes('#'));
      if (match) return match.id;
    }
    const firstWord = note.split(/\s+/)[0]?.toLowerCase() || '';
    for (const t of availableTags) {
      const nameLower = t.name.toLowerCase();
      if (tagNames.some(tg => tg && nameLower.includes(tg.toLowerCase()))) return t.id;
      if (firstWord && firstWord.length > 2 && nameLower.includes(firstWord)) return t.id;
    }
    const nonDefault = availableTags.filter(t => t.id && t.id !== '');
    return nonDefault.length === 1 ? nonDefault[0].id : '';
  }


  // --- 4. TMETRIC API CLIENT (v3) ---
  const TMETRIC_BASE = 'https://app.tmetric.com/api/v3';

  function httpRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: options.method || 'GET',
          url: options.url,
          headers: options.headers || {},
          data: options.data,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              const text = (res.responseText || '').trim();
              if (!text) { resolve(null); return; }
              try { resolve(JSON.parse(text)); } catch (e) { resolve(text); }
            } else reject(new Error(`TMetric error (HTTP ${res.status}): ${res.statusText || 'Request failed'}`));
          },
          onerror: (err) => reject(new Error('Network error connecting to TMetric API')),
        });
      } else {
        fetch(options.url, { method: options.method || 'GET', headers: options.headers || {}, body: options.data })
          .then(async (res) => {
            if (!res.ok) throw new Error(`TMetric error (HTTP ${res.status}): ${res.statusText}`);
            const text = (await res.text()).trim();
            if (!text) return null;
            try { return JSON.parse(text); } catch (e) { return text; }
          })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  async function fetchTMetricUser(token) {
    const bearer = token || getTMetricToken();
    if (!bearer) throw new Error('API Token missing');
    const data = await httpRequest({
      url: `${TMETRIC_BASE}/user`,
      headers: { 'Authorization': `Bearer ${bearer}`, 'Accept': 'application/json' },
    });
    if (data) {
      if (data.id) setTMetricUserId(data.id);
      if (data.activeAccountId) setTMetricAccountId(data.activeAccountId);
    }
    return data;
  }

  async function fetchTMetricProjects() {
    const token = getTMetricToken();
    if (!token) throw new Error('TMetric Token missing');
    let accountId = getTMetricAccountId();
    if (!accountId) {
      const u = await fetchTMetricUser(token);
      accountId = u.activeAccountId;
    }
    const projects = await httpRequest({
      url: `${TMETRIC_BASE}/accounts/${accountId}/projects`,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    return Array.isArray(projects) ? projects : [];
  }

  async function fetchTMetricClients() {
    const token = getTMetricToken();
    if (!token) throw new Error('TMetric Token missing');
    let accountId = getTMetricAccountId();
    if (!accountId) {
      const u = await fetchTMetricUser(token);
      accountId = u.activeAccountId;
    }
    const clients = await httpRequest({
      url: `${TMETRIC_BASE}/accounts/${accountId}/clients`,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    return Array.isArray(clients) ? clients : [];
  }

  async function createTMetricProject(projectData) {
    const token = getTMetricToken();
    if (!token) throw new Error('TMetric Token missing');
    let accountId = getTMetricAccountId();
    if (!accountId) {
      const u = await fetchTMetricUser(token);
      accountId = u.activeAccountId;
    }
    const payload = { name: projectData.name };
    if (projectData.code && projectData.code.trim()) payload.code = projectData.code.trim();
    if (projectData.clientId) payload.clientId = parseInt(projectData.clientId, 10);

    return await httpRequest({
      method: 'POST',
      url: `${TMETRIC_BASE}/accounts/${accountId}/projects`,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      data: JSON.stringify(payload),
    });
  }

  async function fetchTimeEntriesForRange(startDateISO, endDateISO) {
    const token = getTMetricToken();
    if (!token) throw new Error('TMetric Token missing');
    let accountId = getTMetricAccountId();
    if (!accountId) {
      const u = await fetchTMetricUser(token);
      accountId = u.activeAccountId;
    }
    const start = `${startDateISO}T00:00:00Z`;
    const end = `${endDateISO}T23:59:59Z`;
    const entries = await httpRequest({
      url: `${TMETRIC_BASE}/accounts/${accountId}/timeentries?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
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


  // --- 5. PORTAL API CLIENT ---
  function resolveUrl(path) {
    if (!path) return 'https://portal.beyonder.de/';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null')
      ? window.location.origin
      : 'https://portal.beyonder.de';
    return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  function getCsrfToken() {
    const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
    if (input && input.value) return input.value;
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  function getEmployeeId() {
    const emp = document.querySelector('#id_employee');
    return emp ? emp.value : '';
  }

  function getPortalProjectsFromDOM() {
    const select = document.querySelector('#id_project');
    if (!select) return [];
    return Array.from(select.options)
      .filter(o => o.value && o.value !== '')
      .map(o => ({ id: o.value, name: o.textContent.trim() }));
  }

  function getMyProfileUrl() {
    const links = Array.from(document.querySelectorAll('a[href*="/account/employee/detail/"]'));
    const myProfileLink = links.find(a => a.textContent && a.textContent.includes('Mein Profil'));
    if (myProfileLink) return resolveUrl(myProfileLink.getAttribute('href'));
    if (links.length > 0) return resolveUrl(links[0].getAttribute('href'));
    return null;
  }

  async function fetchAssignedProjectsFromProfile() {
    const profileUrl = getMyProfileUrl();
    if (!profileUrl) throw new Error('Could not locate "Mein Profil" link in DOM.');

    const res = await fetch(profileUrl);
    if (!res.ok) throw new Error(`Failed to load profile page (${res.status})`);

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const projectLinks = Array.from(doc.querySelectorAll('a[href*="/management/project/detail/"]'));

    const projectsMap = new Map();
    for (const link of projectLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/management\/project\/detail\/(\d+)\/?/);
      if (!match) continue;

      const projectId = match[1];
      const nameSpan = link.querySelector('.project-name') || link;
      const rawText = (nameSpan.textContent || link.textContent || '').trim();
      if (!rawText) continue;

      const { name, role } = parseProfileProjectName(rawText);
      if (name && !projectsMap.has(name.toLowerCase())) {
        projectsMap.set(name.toLowerCase(), { id: projectId, name, role, href: resolveUrl(href) });
      }
    }

    return Array.from(projectsMap.values());
  }

  async function fetchBookingTagsForProject(projectId) {
    if (!projectId) return [];
    const csrf = getCsrfToken();
    const formData = new URLSearchParams({ project: projectId });
    const targetUrl = resolveUrl('/management/timesheet/form/pattern/htmx?form=timesheet');
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-CSRFToken': csrf,
          'HX-Request': 'true',
          'HX-Target': '#id_timesheet_project_booking_tag',
        },
        body: formData.toString(),
      });
      if (!res.ok) return [];
      const html = await res.text();
      const div = document.createElement('div');
      div.innerHTML = html;
      const select = div.querySelector('select');
      if (!select) return [];
      return Array.from(select.options)
        .filter(o => o.value !== '')
        .map(o => ({ id: o.value, name: o.textContent.trim() }));
    } catch (e) {
      return [];
    }
  }

  async function postTimesheet(data) {
    const csrf = getCsrfToken();
    const emp = data.employee || getEmployeeId();
    const body = new URLSearchParams();
    body.append('csrfmiddlewaretoken', csrf);
    body.append('project', data.projectId);
    body.append('timesheet_project_booking_tag', data.bookingTagId || '');
    body.append('ticket_id', data.ticketId || '');
    body.append('title', data.title);
    body.append('employee', emp);
    body.append('hours_spent', data.hoursSpent);
    body.append('submit', 'Speichern');

    const targetUrl = resolveUrl('/management/timesheet/create/');
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': csrf },
      body: body.toString(),
    });
    return res.ok || res.status === 302;
  }

  async function postZeitabschnitt(data) {
    const csrf = getCsrfToken();
    const emp = data.employee || getEmployeeId();
    const body = new URLSearchParams();
    body.append('csrfmiddlewaretoken', csrf);
    body.append('start_time', data.startTimeStr);
    body.append('end_time', data.endTimeStr);
    body.append('break_time', String(data.breakTimeMins));
    body.append('location', data.location || '1');
    body.append('employee', emp);
    body.append('referer', 'https://portal.beyonder.de/time/tracking/');
    body.append('submit', 'Speichern');

    const targetUrl = resolveUrl('/time/tracking/create/');
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': csrf },
      body: body.toString(),
    });
    return res.ok || res.status === 302;
  }


  // --- 6. UI MODAL & TRIGGER INJECTION ---
  let activeModal = null;

  function injectStyles() {
    if (document.getElementById('tm-sync-styles')) return;
    const style = document.createElement('style');
    style.id = 'tm-sync-styles';
    style.textContent = `
      .tm-sync-btn {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        color: #fff; font-weight: 600; padding: 6px 14px; border-radius: 8px;
        display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: none; font-size: 14px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease; margin-left: 12px;
      }
      .tm-sync-btn:hover { background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); }
      .tm-sync-btn-secondary {
        background: #f1f5f9; color: #0284c7; border: 1px solid #bae6fd; font-weight: 600;
        padding: 6px 14px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;
        cursor: pointer; font-size: 14px; margin-left: 8px; transition: all 0.2s ease;
      }
      .tm-sync-btn-secondary:hover { background: #e0f2fe; }
      .tm-modal-overlay {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
        z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 16px;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .tm-modal-card {
        background: #fff; border-radius: 12px; width: 100%; max-width: 1040px; max-height: 92vh;
        display: flex; flex-direction: column; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); overflow: hidden;
      }
      .tm-modal-header { padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
      .tm-modal-header h2 { margin: 0; font-size: 18px; font-weight: 700; color: #0f172a; }
      .tm-modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
      .tm-modal-footer { padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
      .tm-day-section { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
      .tm-day-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; margin-bottom: 12px; }
      .tm-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
      .tm-table th { background: #f1f5f9; color: #334155; font-weight: 600; text-align: left; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; }
      .tm-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
      .tm-input, .tm-select { width: 100%; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
      .tm-checkbox { width: 18px; height: 18px; cursor: pointer; accent-color: #0284c7; }
      .tm-btn-primary { background: #0284c7; color: #fff; padding: 8px 18px; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; }
      .tm-btn-primary:hover { background: #0369a1; }
      .tm-btn-secondary { background: #e2e8f0; color: #334155; padding: 8px 16px; border-radius: 6px; font-weight: 600; border: none; cursor: pointer; }
      .tm-btn-secondary:hover { background: #cbd5e1; }
      .tm-card-info { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; color: #0369a1; font-size: 13px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  function showSettingsModal(onSaved) {
    closeModal(); injectStyles();
    const token = getTMetricToken();
    const overlay = document.createElement('div');
    overlay.className = 'tm-modal-overlay';
    overlay.innerHTML = `
      <div class="tm-modal-card" style="max-width: 480px;">
        <div class="tm-modal-header">
          <h2>⚙️ TMetric Sync Configuration</h2>
          <button id="tm-close" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
        </div>
        <div class="tm-modal-body">
          <p style="font-size:14px;color:#475569;margin-bottom:16px;">
            Enter your TMetric API Bearer Token from TMetric Profile/API settings.
          </p>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">API Token</label>
            <input type="password" id="tm-token-in" class="tm-input" value="${token}" placeholder="Paste API token..." />
          </div>
          <div id="tm-status" style="font-size:13px;min-height:20px;"></div>
        </div>
        <div class="tm-modal-footer">
          <button id="tm-test-btn" class="tm-btn-secondary">Test Connection</button>
          <button id="tm-save-btn" class="tm-btn-primary">Save & Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    activeModal = overlay;

    overlay.querySelector('#tm-close').onclick = closeModal;
    overlay.querySelector('#tm-test-btn').onclick = async () => {
      const val = overlay.querySelector('#tm-token-in').value.trim();
      const status = overlay.querySelector('#tm-status');
      if (!val) { status.innerHTML = '<span style="color:red;">Token missing</span>'; return; }
      status.innerHTML = '<span style="color:#0284c7;">Testing...</span>';
      try {
        const u = await fetchTMetricUser(val);
        status.innerHTML = `<span style="color:green;">✓ Connected as ${u.name} (Account ID: ${u.activeAccountId})</span>`;
      } catch (e) {
        status.innerHTML = `<span style="color:red;">❌ ${e.message}</span>`;
      }
    };
    overlay.querySelector('#tm-save-btn').onclick = async () => {
      const val = overlay.querySelector('#tm-token-in').value.trim();
      if (!val) return;
      setTMetricToken(val);
      try { await fetchTMetricUser(val); } catch (e) {}
      closeModal();
      if (onSaved) onSaved();
    };
  }

  async function openProjectSyncModal() {
    injectStyles(); closeModal();
    const token = getTMetricToken();
    if (!token) { showSettingsModal(() => openProjectSyncModal()); return; }

    const loadOverlay = document.createElement('div');
    loadOverlay.className = 'tm-modal-overlay';
    loadOverlay.innerHTML = `
      <div class="tm-modal-card" style="max-width:440px;text-align:center;padding:30px;">
        <div style="font-size:24px;margin-bottom:8px;">⏳</div>
        <h3 style="margin:0;">Scanning Profile Projects...</h3>
        <p style="color:#64748b;font-size:13px;">Reading assigned projects from your Portal Profile</p>
      </div>
    `;
    document.body.appendChild(loadOverlay); activeModal = loadOverlay;

    let portalAssigned = [];
    let tmExisting = [];
    let tmClients = [];

    try {
      portalAssigned = await fetchAssignedProjectsFromProfile();
      tmExisting = await fetchTMetricProjects();
      tmClients = await fetchTMetricClients();
    } catch (e) {
      closeModal(); alert(`Error: ${e.message}`); return;
    }

    const existingNames = new Set(tmExisting.map(p => p.name.toLowerCase().trim()));
    const missing = portalAssigned.filter(p => !existingNames.has(p.name.toLowerCase().trim()));

    if (missing.length === 0) {
      closeModal();
      alert(`✅ All ${portalAssigned.length} assigned Portal projects already exist in TMetric!`);
      return;
    }

    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'tm-modal-overlay';
    overlay.innerHTML = `
      <div class="tm-modal-card" style="max-width:860px;">
        <div class="tm-modal-header">
          <h2>📁 Sync Projects: Create Missing Projects in TMetric</h2>
          <button id="tm-close" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
        </div>
        <div class="tm-modal-body">
          <div class="tm-card-info">
            Found <strong>${missing.length}</strong> assigned Portal project(s) missing from TMetric.
            Specify optional Client and Project Code for each project before creating.
          </div>

          <table class="tm-table">
            <thead>
              <tr>
                <th style="width:36px;text-align:center;"><input type="checkbox" class="tm-checkbox select-all-proj" checked /></th>
                <th>Portal Project Name</th>
                <th style="width:20%;">Assigned Role</th>
                <th style="width:28%;">TMetric Client (Optional)</th>
                <th style="width:18%;">Project Code (Optional)</th>
              </tr>
            </thead>
            <tbody>
              ${missing.map((p, idx) => `
                <tr data-idx="${idx}">
                  <td style="text-align:center;"><input type="checkbox" class="tm-checkbox proj-chk" checked /></td>
                  <td style="font-weight:600;"><input type="text" class="tm-input proj-name" value="${p.name}" /></td>
                  <td><span style="font-size:12px;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:4px;">${p.role || 'Member'}</span></td>
                  <td>
                    <select class="tm-select proj-client">
                      <option value="">-- No Client --</option>
                      ${tmClients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="text" class="tm-input proj-code" placeholder="e.g. PRJ-01" /></td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="margin-top:16px;font-size:12px;color:#64748b;background:#fffbe0;border:1px solid #ffe58f;padding:10px 14px;border-radius:6px;">
            🔒 <strong>Safety Rule:</strong> Project Sync will <u>NEVER</u> delete or modify existing projects in TMetric. It only creates missing projects upon explicit confirmation.
          </div>

          <div id="tm-proj-log" style="margin-top:12px;font-weight:600;font-size:13px;"></div>
        </div>

        <div class="tm-modal-footer">
          <button id="tm-cancel-proj" class="tm-btn-secondary">Cancel</button>
          <button id="tm-submit-proj" class="tm-btn-primary">Create Selected Projects in TMetric</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay); activeModal = overlay;

    overlay.querySelector('#tm-close').onclick = closeModal;
    overlay.querySelector('#tm-cancel-proj').onclick = closeModal;

    const selectAll = overlay.querySelector('.select-all-proj');
    const rowChks = overlay.querySelectorAll('.proj-chk');
    selectAll.onchange = () => { rowChks.forEach(c => { c.checked = selectAll.checked; }); };

    const submitBtn = overlay.querySelector('#tm-submit-proj');
    const log = overlay.querySelector('#tm-proj-log');

    submitBtn.onclick = async () => {
      submitBtn.disabled = true; submitBtn.style.opacity = '0.6';
      const rows = overlay.querySelectorAll('tbody tr');
      let created = 0;

      for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        if (!tr.querySelector('.proj-chk').checked) continue;
        const name = tr.querySelector('.proj-name').value.trim();
        const clientId = tr.querySelector('.proj-client').value;
        const code = tr.querySelector('.proj-code').value.trim();

        if (!name) continue;

        log.innerHTML = `<span style="color:#0284c7;">Creating project ${i + 1} of ${rows.length}: "${name}"...</span>`;
        try {
          await createTMetricProject({ name, clientId, code });
          created++;
        } catch (e) {
          console.error(`Failed to create "${name}":`, e);
        }
      }

      log.innerHTML = `<span style="color:green;">✅ Created ${created} new project(s) in TMetric!</span>`;
      setTimeout(() => closeModal(), 1500);
    };
  }

  async function openSyncSummaryModal(rangeMode = '3days', baseDateISO = formatDateISO(new Date())) {
    injectStyles(); closeModal();
    const token = getTMetricToken();
    if (!token) { showSettingsModal(() => openSyncSummaryModal(rangeMode, baseDateISO)); return; }

    const portalProjects = getPortalProjectsFromDOM();
    const savedMappings = getProjectMappings();

    let datesToFetch = rangeMode === '3days' ? getPastDates(3, baseDateISO) : [baseDateISO];
    const startDateISO = datesToFetch[0];
    const endDateISO = datesToFetch[datesToFetch.length - 1];

    const loadOverlay = document.createElement('div');
    loadOverlay.className = 'tm-modal-overlay';
    loadOverlay.innerHTML = `
      <div class="tm-modal-card" style="max-width:420px;text-align:center;padding:30px;">
        <div style="font-size:24px;margin-bottom:8px;">⏳</div>
        <h3 style="margin:0;">Fetching TMetric Time Entries...</h3>
        <p style="color:#64748b;font-size:13px;">${startDateISO} to ${endDateISO}</p>
      </div>
    `;
    document.body.appendChild(loadOverlay); activeModal = loadOverlay;

    let allEntries = [];
    try {
      allEntries = await fetchTimeEntriesForRange(startDateISO, endDateISO);
    } catch (e) {
      closeModal(); alert(`Error: ${e.message}`); return;
    }

    const entriesByDate = {};
    datesToFetch.forEach(d => { entriesByDate[d] = []; });
    allEntries.forEach(entry => {
      const entryDate = formatDateISO(entry.startTime);
      if (entriesByDate[entryDate]) entriesByDate[entryDate].push(entry);
    });

    const daysData = [];
    for (const dateISO of datesToFetch) {
      const dayEntries = entriesByDate[dateISO] || [];
      const processedRows = [];

      for (const entry of dayEntries) {
        const tmProjName = entry.project?.name || '';
        const tmProjId = entry.project?.id ? String(entry.project.id) : '';

        const { bestMatch } = matchProject(tmProjName, portalProjects, savedMappings, tmProjId);
        const { ticketId, title } = parseTicketAndTitle(entry);
        const hoursSpentStr = roundTo15Min(secondsToDecimalHours(entry.duration));

        let availableTags = [];
        if (bestMatch) availableTags = await fetchBookingTagsForProject(bestMatch.id);
        const matchedTagId = matchBookingTag({ ticketId, note: title, tags: entry.tags || [] }, availableTags);

        processedRows.push({
          tmetricId: tmProjId,
          tmetricName: tmProjName,
          matchedProject: bestMatch,
          availableTags,
          matchedTagId,
          ticketId,
          title,
          hoursSpentStr,
          selected: true,
        });
      }

      const zaInfo = calculateZeitabschnitt(dayEntries);
      daysData.push({
        dateISO,
        entries: dayEntries,
        processedRows,
        zaInfo,
        includeZeitabschnitt: zaInfo !== null,
      });
    }

    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'tm-modal-overlay';
    overlay.innerHTML = `
      <div class="tm-modal-card">
        <div class="tm-modal-header">
          <h2>🚀 TMetric ➔ Beyonder Sync</h2>
          <div>
            <button id="tm-sync-proj" class="tm-btn-secondary" style="margin-right:8px;">📁 Sync Projects</button>
            <button id="tm-settings" class="tm-btn-secondary" style="margin-right:8px;">⚙️ Settings</button>
            <button id="tm-close" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
          </div>
        </div>
        <div class="tm-modal-body">
          <div class="tm-card-info" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <strong>Sync Range:</strong>
              <select id="tm-mode-select" class="tm-select" style="width:auto;display:inline-block;padding:4px 8px;">
                <option value="3days" ${rangeMode === '3days' ? 'selected' : ''}>Past 3 Days</option>
                <option value="single" ${rangeMode === 'single' ? 'selected' : ''}>Single Date</option>
              </select>
              <input type="date" id="tm-base-date" class="tm-input" style="width:auto;display:inline-block;padding:4px 8px;" value="${baseDateISO}" />
            </div>
            <div>
              <button id="tm-check-all" class="tm-btn-secondary" style="font-size:12px;padding:4px 10px;">Select All</button>
              <button id="tm-uncheck-all" class="tm-btn-secondary" style="font-size:12px;padding:4px 10px;margin-left:4px;">Deselect All</button>
            </div>
          </div>

          ${daysData.map((day, dayIdx) => `
            <div class="tm-day-section" data-day-idx="${dayIdx}">
              <div class="tm-day-header">
                <div style="display:flex;align-items:center;gap:8px;">
                  <h3 style="margin:0;font-size:16px;color:#0f172a;">📅 ${day.dateISO}</h3>
                  <span style="font-size:12px;color:#64748b;">(${day.processedRows.length} timesheets)</span>
                </div>
                ${day.zaInfo ? `
                  <div style="display:flex;align-items:center;gap:8px;font-size:13px;background:#f1f5f9;padding:6px 12px;border-radius:6px;">
                    <input type="checkbox" class="tm-checkbox day-za-chk" id="za-chk-${dayIdx}" ${day.includeZeitabschnitt ? 'checked' : ''} />
                    <label for="za-chk-${dayIdx}" style="cursor:pointer;font-weight:600;color:#1e293b;">
                      Submit Zeitabschnitt (${day.zaInfo.startTimeStr.split(' ')[1]} - ${day.zaInfo.endTimeStr.split(' ')[1]}, Pause: ${day.zaInfo.breakTimeMins}m)
                    </label>
                  </div>
                ` : '<span style="font-size:12px;color:#94a3b8;">No Zeitabschnitt data</span>'}
              </div>

              ${day.zaInfo ? `
                <div class="za-details-box" style="display:${day.includeZeitabschnitt ? 'grid' : 'none'};grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
                  <div><label>Startzeit</label><input type="text" class="tm-input day-za-start" value="${day.zaInfo.startTimeStr}" readonly /></div>
                  <div><label>Endzeit</label><input type="text" class="tm-input day-za-end" value="${day.zaInfo.endTimeStr}" readonly /></div>
                  <div><label>Pause (Min)</label><input type="number" class="tm-input day-za-break" value="${day.zaInfo.breakTimeMins}" min="0" /></div>
                  <div>
                    <label>Standort</label>
                    <select class="tm-select day-za-location">
                      <option value="1" selected>Home-Office</option>
                      <option value="0">Büro Köln-Ehrenfeld</option>
                    </select>
                  </div>
                </div>
              ` : ''}

              ${day.processedRows.length > 0 ? `
                <table class="tm-table">
                  <thead>
                    <tr>
                      <th style="width:36px;text-align:center;"><input type="checkbox" class="tm-checkbox day-select-all-chk" checked /></th>
                      <th style="width:25%;">Projekt</th>
                      <th style="width:20%;">Buchungs-Label-Muster</th>
                      <th style="width:12%;">Ticket-ID</th>
                      <th>Titel</th>
                      <th style="width:10%;">Stunden</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${day.processedRows.map((row, rowIdx) => `
                      <tr data-row-idx="${rowIdx}">
                        <td style="text-align:center;"><input type="checkbox" class="tm-checkbox row-enable-chk" ${row.selected ? 'checked' : ''} /></td>
                        <td>
                          <select class="tm-select row-project">
                            <option value="">-- Select Project --</option>
                            ${portalProjects.map(p => `
                              <option value="${p.id}" ${row.matchedProject && String(row.matchedProject.id) === String(p.id) ? 'selected' : ''}>
                                ${p.name}
                              </option>
                            `).join('')}
                          </select>
                        </td>
                        <td>
                          <select class="tm-select row-tag">
                            <option value="">-- Select Tag --</option>
                            ${row.availableTags.map(t => `
                              <option value="${t.id}" ${String(row.matchedTagId) === String(t.id) ? 'selected' : ''}>
                                ${t.name}
                              </option>
                            `).join('')}
                          </select>
                        </td>
                        <td><input type="text" class="tm-input row-ticket" value="${row.ticketId}" /></td>
                        <td><input type="text" class="tm-input row-title" value="${row.title}" maxlength="100" /></td>
                        <td><input type="text" class="tm-input row-hours" value="${row.hoursSpentStr}" style="text-align:right;" /></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : '<p style="font-size:13px;color:#94a3b8;margin:8px 0 0 0;">No time entries for this day.</p>'}
            </div>
          `).join('')}

          <div id="tm-status-log" style="margin-top:12px;font-weight:600;font-size:13px;"></div>
        </div>
        <div class="tm-modal-footer">
          <button id="tm-cancel" class="tm-btn-secondary">Cancel</button>
          <button id="tm-submit-all" class="tm-btn-primary">Approve & Sync Selected</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay); activeModal = overlay;

    overlay.querySelector('#tm-close').onclick = closeModal;
    overlay.querySelector('#tm-cancel').onclick = closeModal;
    overlay.querySelector('#tm-settings').onclick = () => showSettingsModal();
    overlay.querySelector('#tm-sync-proj').onclick = () => openProjectSyncModal();

    const modeSelect = overlay.querySelector('#tm-mode-select');
    const baseDatePicker = overlay.querySelector('#tm-base-date');
    modeSelect.onchange = () => openSyncSummaryModal(modeSelect.value, baseDatePicker.value);
    baseDatePicker.onchange = () => openSyncSummaryModal(modeSelect.value, baseDatePicker.value);

    overlay.querySelector('#tm-check-all').onclick = () => {
      overlay.querySelectorAll('.row-enable-chk, .day-za-chk, .day-select-all-chk').forEach(chk => {
        chk.checked = true; chk.dispatchEvent(new Event('change'));
      });
    };
    overlay.querySelector('#tm-uncheck-all').onclick = () => {
      overlay.querySelectorAll('.row-enable-chk, .day-za-chk, .day-select-all-chk').forEach(chk => {
        chk.checked = false; chk.dispatchEvent(new Event('change'));
      });
    };

    daysData.forEach((day, dayIdx) => {
      const daySec = overlay.querySelector(`.tm-day-section[data-day-idx="${dayIdx}"]`);
      if (!daySec) return;

      const zaChk = daySec.querySelector('.day-za-chk');
      const zaBox = daySec.querySelector('.za-details-box');
      if (zaChk && zaBox) {
        zaChk.onchange = () => { zaBox.style.display = zaChk.checked ? 'grid' : 'none'; };
      }

      const daySelectAll = daySec.querySelector('.day-select-all-chk');
      const rowCheckboxes = daySec.querySelectorAll('.row-enable-chk');
      if (daySelectAll) {
        daySelectAll.onchange = () => {
          rowCheckboxes.forEach(r => { r.checked = daySelectAll.checked; });
        };
      }

      const rowProjects = daySec.querySelectorAll('.row-project');
      rowProjects.forEach((select, rowIdx) => {
        select.onchange = async () => {
          const projId = select.value;
          const row = day.processedRows[rowIdx];
          if (row.tmetricId && projId) saveProjectMapping(row.tmetricId, projId);

          const tagSelect = daySec.querySelectorAll('.row-tag')[rowIdx];
          tagSelect.innerHTML = '<option value="">Loading...</option>';
          const tags = await fetchBookingTagsForProject(projId);
          tagSelect.innerHTML = '<option value="">-- Select Tag --</option>' +
            tags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

          const matched = matchBookingTag({ ticketId: row.ticketId, note: row.title }, tags);
          if (matched) tagSelect.value = matched;
        };
      });
    });

    const submitBtn = overlay.querySelector('#tm-submit-all');
    const log = overlay.querySelector('#tm-status-log');

    submitBtn.onclick = async () => {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.6';

      let totalTimesheetsSubmitted = 0;
      let totalZeitabschnitteSubmitted = 0;

      for (let dayIdx = 0; dayIdx < daysData.length; dayIdx++) {
        const day = daysData[dayIdx];
        const daySec = overlay.querySelector(`.tm-day-section[data-day-idx="${dayIdx}"]`);
        if (!daySec) continue;

        const rows = daySec.querySelectorAll('tbody tr');
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const tr = rows[rowIdx];
          const isEnabled = tr.querySelector('.row-enable-chk').checked;
          if (!isEnabled) continue;

          const projId = tr.querySelector('.row-project').value;
          const tagId = tr.querySelector('.row-tag').value;
          const ticketId = tr.querySelector('.row-ticket').value.trim();
          const title = tr.querySelector('.row-title').value.trim();
          const hoursSpent = tr.querySelector('.row-hours').value.trim();

          if (!projId) {
            log.innerHTML = `<span style="color:red;">[${day.dateISO}] Row ${rowIdx + 1}: Select a project.</span>`;
            submitBtn.disabled = false; submitBtn.style.opacity = '1'; return;
          }

          log.innerHTML = `<span style="color:#0284c7;">Creating timesheet for ${day.dateISO} (${title})...</span>`;
          const ok = await postTimesheet({ projectId: projId, bookingTagId: tagId, ticketId, title, hoursSpent });
          if (ok) totalTimesheetsSubmitted++;
        }

        const zaChk = daySec.querySelector('.day-za-chk');
        if (zaChk && zaChk.checked && day.zaInfo) {
          log.innerHTML = `<span style="color:#0284c7;">Creating Zeitabschnitt for ${day.dateISO}...</span>`;
          const startStr = daySec.querySelector('.day-za-start').value;
          const endStr = daySec.querySelector('.day-za-end').value;
          const breakMins = parseInt(daySec.querySelector('.day-za-break').value, 10) || 0;
          const loc = daySec.querySelector('.day-za-location').value;

          const okZA = await postZeitabschnitt({ startTimeStr: startStr, endTimeStr: endStr, breakTimeMins: breakMins, location: loc });
          if (okZA) totalZeitabschnitteSubmitted++;
        }
      }

      log.innerHTML = `<span style="color:green;">✅ Synced ${totalTimesheetsSubmitted} timesheets & ${totalZeitabschnitteSubmitted} Zeitabschnitte successfully! Reloading...</span>`;
      setTimeout(() => { closeModal(); window.location.reload(); }, 1500);
    };
  }

  function injectSyncTrigger() {
    if (document.getElementById('tm-sync-trigger-btn')) return;
    injectStyles();

    const container = document.createElement('div');
    container.style.display = 'inline-flex';
    container.style.alignItems = 'center';

    const syncTimeBtn = document.createElement('button');
    syncTimeBtn.id = 'tm-sync-trigger-btn';
    syncTimeBtn.className = 'tm-sync-btn';
    syncTimeBtn.innerHTML = '🚀 Sync from TMetric';
    syncTimeBtn.onclick = () => openSyncSummaryModal('3days');

    const syncProjectsBtn = document.createElement('button');
    syncProjectsBtn.id = 'tm-sync-projects-trigger-btn';
    syncProjectsBtn.className = 'tm-sync-btn-secondary';
    syncProjectsBtn.innerHTML = '📁 Sync Projects to TMetric';
    syncProjectsBtn.onclick = () => openProjectSyncModal();

    container.appendChild(syncTimeBtn);
    container.appendChild(syncProjectsBtn);

    const heading = document.querySelector('h1');
    if (heading) { heading.appendChild(container); return; }

    const nav = document.querySelector('nav');
    if (nav) { nav.appendChild(container); return; }

    container.style.position = 'fixed'; container.style.bottom = '20px'; container.style.right = '20px'; container.style.zIndex = '9999';
    document.body.appendChild(container);
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSyncTrigger);
  } else {
    injectSyncTrigger();
  }
})();
