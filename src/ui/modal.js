/**
 * UI Overlay Modal and Injected Controls for TMetric to Portal Sync
 */

import { getTMetricToken, setTMetricToken, saveProjectMapping, getProjectMappings } from '../storage/config.js';
import { fetchTimeEntriesForRange, fetchTMetricUser, fetchTMetricProjects, fetchTMetricClients, createTMetricProject } from '../api/tmetric.js';
import { getPortalProjectsFromDOM, fetchBookingTagsForProject, postTimesheet, postZeitabschnitt, fetchAssignedProjectsFromProfile } from '../api/portal.js';
import { parseTicketAndTitle, matchProject, matchBookingTag, parseProfileProjectName } from '../utils/matching.js';
import { secondsToDecimalHours, roundTo15Min, calculateZeitabschnitt, formatDateISO, getPastDates } from '../utils/time.js';

let activeModalOverlay = null;

/**
 * Injects CSS styles for the modal UI into document head.
 */
export function injectStyles() {
  if (document.getElementById('tmetric-sync-styles')) return;

  const style = document.createElement('style');
  style.id = 'tmetric-sync-styles';
  style.textContent = `
    .tm-sync-btn {
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      color: #ffffff;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      border: none;
      font-size: 14px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: all 0.2s ease;
      margin-left: 12px;
    }
    .tm-sync-btn:hover {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }
    .tm-sync-btn-secondary {
      background: #f1f5f9;
      color: #0284c7;
      border: 1px solid #bae6fd;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 14px;
      margin-left: 8px;
      transition: all 0.2s ease;
    }
    .tm-sync-btn-secondary:hover {
      background: #e0f2fe;
    }
    .tm-modal-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(4px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .tm-modal-card {
      background: #ffffff;
      border-radius: 12px;
      width: 100%;
      max-width: 1040px;
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .tm-modal-header {
      padding: 16px 24px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tm-modal-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
    }
    .tm-modal-body {
      padding: 20px 24px;
      overflow-y: auto;
      flex: 1;
    }
    .tm-modal-footer {
      padding: 16px 24px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tm-day-section {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .tm-day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 12px;
    }
    .tm-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 8px;
    }
    .tm-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 600;
      text-align: left;
      padding: 8px 10px;
      border-bottom: 2px solid #cbd5e1;
    }
    .tm-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .tm-input, .tm-select {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 13px;
      box-sizing: border-box;
    }
    .tm-checkbox {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: #0284c7;
    }
    .tm-btn-primary {
      background: #0284c7;
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 6px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .tm-btn-primary:hover { background: #0369a1; }
    .tm-btn-secondary {
      background: #e2e8f0;
      color: #334155;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .tm-btn-secondary:hover { background: #cbd5e1; }
    .tm-card-info {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      color: #0369a1;
      font-size: 13px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Shows the Settings Modal for TMetric API Token configuration.
 */
export function showSettingsModal(onSavedCallback) {
  closeModal();
  injectStyles();

  const currentToken = getTMetricToken();

  const overlay = document.createElement('div');
  overlay.className = 'tm-modal-overlay';
  overlay.innerHTML = `
    <div class="tm-modal-card" style="max-width: 480px;">
      <div class="tm-modal-header">
        <h2>⚙️ TMetric Sync Configuration</h2>
        <button id="tm-close-modal" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div class="tm-modal-body">
        <p style="font-size:14px;color:#475569;margin-bottom:16px;">
          Enter your TMetric API Bearer Token from TMetric Profile / API Settings.
        </p>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#1e293b;">API Token</label>
          <input type="password" id="tm-token-input" class="tm-input" value="${currentToken}" placeholder="Paste API token here..." />
        </div>
        <div id="tm-status-msg" style="font-size:13px;min-height:20px;"></div>
      </div>
      <div class="tm-modal-footer">
        <button id="tm-test-token-btn" class="tm-btn-secondary">Test Connection</button>
        <button id="tm-save-token-btn" class="tm-btn-primary">Save & Continue</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  activeModalOverlay = overlay;

  const closeBtn = overlay.querySelector('#tm-close-modal');
  const tokenInput = overlay.querySelector('#tm-token-input');
  const statusMsg = overlay.querySelector('#tm-status-msg');
  const testBtn = overlay.querySelector('#tm-test-token-btn');
  const saveBtn = overlay.querySelector('#tm-save-token-btn');

  closeBtn.onclick = closeModal;

  testBtn.onclick = async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      statusMsg.innerHTML = '<span style="color:#dc2626;">Please enter a token.</span>';
      return;
    }
    statusMsg.innerHTML = '<span style="color:#0284c7;">Testing connection...</span>';
    try {
      const user = await fetchTMetricUser(token);
      statusMsg.innerHTML = `<span style="color:#16a34a;">✓ Connected as ${user.name} (Account ID: ${user.activeAccountId})</span>`;
    } catch (e) {
      statusMsg.innerHTML = `<span style="color:#dc2626;">❌ Connection failed: ${e.message}</span>`;
    }
  };

  saveBtn.onclick = async () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    setTMetricToken(token);
    try {
      await fetchTMetricUser(token);
    } catch (e) {}
    closeModal();
    if (onSavedCallback) onSavedCallback();
  };
}

/**
 * Closes currently open modal overlay.
 */
export function closeModal() {
  if (activeModalOverlay) {
    activeModalOverlay.remove();
    activeModalOverlay = null;
  }
}

/**
 * Opens Project Sync Modal to create missing Portal assigned projects in TMetric.
 */
export async function openProjectSyncModal() {
  injectStyles();
  closeModal();

  const token = getTMetricToken();
  if (!token) {
    showSettingsModal(() => openProjectSyncModal());
    return;
  }

  // Show loading overlay
  const overlay = document.createElement('div');
  overlay.className = 'tm-modal-overlay';
  overlay.innerHTML = `
    <div class="tm-modal-card" style="max-width: 480px; text-align: center; padding: 40px;">
      <div style="font-size: 24px; margin-bottom: 12px;">⏳</div>
      <h3 style="margin: 0; color: #0f172a;">Scanning Assigned Projects...</h3>
      <p style="color: #64748b; font-size: 14px;">Reading your profile page & querying TMetric projects</p>
    </div>
  `;
  document.body.appendChild(overlay);
  activeModalOverlay = overlay;

  let portalAssignedProjects = [];
  let tmetricExistingProjects = [];
  let tmetricClients = [];

  try {
    portalAssignedProjects = await fetchAssignedProjectsFromProfile(parseProfileProjectName);
    tmetricExistingProjects = await fetchTMetricProjects();
    tmetricClients = await fetchTMetricClients();
  } catch (e) {
    closeModal();
    alert(`Error scanning projects: ${e.message}`);
    return;
  }

  // Find assigned Portal projects that do NOT exist in TMetric
  const existingNamesLower = new Set(tmetricExistingProjects.map(p => p.name.toLowerCase().trim()));
  const missingProjects = portalAssignedProjects.filter(p => !existingNamesLower.has(p.name.toLowerCase().trim()));

  if (missingProjects.length === 0) {
    closeModal();
    alert(`✅ All ${portalAssignedProjects.length} assigned Beyonder Portal projects already exist in your TMetric account! No new projects to create.`);
    return;
  }

  // Render Project Creation Modal
  closeModal();
  const mainOverlay = document.createElement('div');
  mainOverlay.className = 'tm-modal-overlay';
  mainOverlay.innerHTML = `
    <div class="tm-modal-card" style="max-width: 860px;">
      <div class="tm-modal-header">
        <h2>📁 Sync Projects: Create Missing Projects in TMetric</h2>
        <button id="tm-close-modal" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div class="tm-modal-body">
        <div class="tm-card-info">
          Found <strong>${missingProjects.length}</strong> assigned Portal project(s) missing from TMetric.
          Specify optional Client and Project Code for each project before creating.
        </div>

        <table class="tm-table">
          <thead>
            <tr>
              <th style="width:36px;text-align:center;">
                <input type="checkbox" class="tm-checkbox select-all-projects-chk" checked />
              </th>
              <th>Portal Project Name</th>
              <th style="width:20%;">Assigned Role</th>
              <th style="width:28%;">TMetric Client (Optional)</th>
              <th style="width:18%;">Project Code (Optional)</th>
            </tr>
          </thead>
          <tbody>
            ${missingProjects.map((p, idx) => `
              <tr data-idx="${idx}">
                <td style="text-align:center;">
                  <input type="checkbox" class="tm-checkbox proj-enable-chk" checked />
                </td>
                <td style="font-weight:600;color:#0f172a;">
                  <input type="text" class="tm-input proj-name-input" value="${p.name}" />
                </td>
                <td>
                  <span style="font-size:12px;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:4px;display:inline-block;">
                    ${p.role || 'Member'}
                  </span>
                </td>
                <td>
                  <select class="tm-select proj-client-select">
                    <option value="">-- No Client --</option>
                    ${tmetricClients.map(c => `
                      <option value="${c.id}">${c.name}</option>
                    `).join('')}
                  </select>
                </td>
                <td>
                  <input type="text" class="tm-input proj-code-input" placeholder="e.g. PRJ-01" />
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:16px;font-size:12px;color:#64748b;background:#fffbe0;border:1px solid #ffe58f;padding:10px 14px;border-radius:6px;">
          🔒 <strong>Safety Rule:</strong> Project Sync will <u>NEVER</u> delete or modify existing projects in TMetric. It will only create missing projects upon explicit confirmation.
        </div>

        <div id="tm-proj-progress" style="margin-top:14px;font-weight:600;font-size:13px;"></div>
      </div>

      <div class="tm-modal-footer">
        <button id="tm-cancel-proj-btn" class="tm-btn-secondary">Cancel</button>
        <button id="tm-submit-proj-btn" class="tm-btn-primary">Create Selected Projects in TMetric</button>
      </div>
    </div>
  `;

  document.body.appendChild(mainOverlay);
  activeModalOverlay = mainOverlay;

  // Event Listeners
  mainOverlay.querySelector('#tm-close-modal').onclick = closeModal;
  mainOverlay.querySelector('#tm-cancel-proj-btn').onclick = closeModal;

  const selectAllChk = mainOverlay.querySelector('.select-all-projects-chk');
  const projCheckboxes = mainOverlay.querySelectorAll('.proj-enable-chk');

  selectAllChk.onchange = () => {
    projCheckboxes.forEach(chk => { chk.checked = selectAllChk.checked; });
  };

  const submitBtn = mainOverlay.querySelector('#tm-submit-proj-btn');
  const progressStatus = mainOverlay.querySelector('#tm-proj-progress');

  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';

    const rows = mainOverlay.querySelectorAll('tbody tr');
    let createdCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      const isEnabled = tr.querySelector('.proj-enable-chk').checked;
      if (!isEnabled) continue;

      const name = tr.querySelector('.proj-name-input').value.trim();
      const clientId = tr.querySelector('.proj-client-select').value;
      const code = tr.querySelector('.proj-code-input').value.trim();

      if (!name) continue;

      progressStatus.innerHTML = `<span style="color:#0284c7;">Creating project ${i + 1} of ${rows.length}: "${name}"...</span>`;

      try {
        await createTMetricProject({ name, clientId, code });
        createdCount++;
      } catch (e) {
        console.error(`Failed to create project "${name}":`, e);
      }
    }

    progressStatus.innerHTML = `<span style="color:#16a34a;">✅ Successfully created ${createdCount} new project(s) in TMetric!</span>`;

    setTimeout(() => {
      closeModal();
    }, 1500);
  };
}

/**
 * Opens the Summary & Approval Modal displaying multi-day time entries with selective checkboxes.
 * 
 * @param {'3days'|'single'} rangeMode 
 * @param {string} baseDateISO 
 */
export async function openSyncSummaryModal(rangeMode = '3days', baseDateISO = formatDateISO(new Date())) {
  injectStyles();
  closeModal();

  const token = getTMetricToken();
  if (!token) {
    showSettingsModal(() => openSyncSummaryModal(rangeMode, baseDateISO));
    return;
  }

  const portalProjects = getPortalProjectsFromDOM();
  const savedMappings = getProjectMappings();

  // Determine date list
  let datesToFetch = [];
  if (rangeMode === '3days') {
    datesToFetch = getPastDates(3, baseDateISO);
  } else {
    datesToFetch = [baseDateISO];
  }

  const startDateISO = datesToFetch[0];
  const endDateISO = datesToFetch[datesToFetch.length - 1];

  // Create loading overlay
  const overlay = document.createElement('div');
  overlay.className = 'tm-modal-overlay';
  overlay.innerHTML = `
    <div class="tm-modal-card" style="max-width: 500px; text-align: center; padding: 40px;">
      <div style="font-size: 24px; margin-bottom: 12px;">⏳</div>
      <h3 style="margin: 0; color: #0f172a;">Fetching TMetric Time Entries...</h3>
      <p style="color: #64748b; font-size: 14px;">Range: ${startDateISO} to ${endDateISO}</p>
    </div>
  `;
  document.body.appendChild(overlay);
  activeModalOverlay = overlay;

  let allEntries = [];
  try {
    allEntries = await fetchTimeEntriesForRange(startDateISO, endDateISO);
  } catch (e) {
    closeModal();
    alert(`Error fetching TMetric entries: ${e.message}`);
    return;
  }

  // Group entries by Date (YYYY-MM-DD)
  const entriesByDate = {};
  datesToFetch.forEach(d => { entriesByDate[d] = []; });

  allEntries.forEach(entry => {
    const entryDate = formatDateISO(entry.startTime);
    if (entriesByDate[entryDate]) {
      entriesByDate[entryDate].push(entry);
    }
  });

  // Pre-process and match entries for each day
  const daysData = [];

  for (const dateISO of datesToFetch) {
    const dayEntries = entriesByDate[dateISO] || [];
    const processedRows = [];

    for (const entry of dayEntries) {
      const tmetricProjName = entry.project?.name || '';
      const tmetricProjId = entry.project?.id ? String(entry.project.id) : '';

      const { bestMatch } = matchProject(tmetricProjName, portalProjects, savedMappings, tmetricProjId);
      const { ticketId, title } = parseTicketAndTitle(entry);
      const hoursDecimal = secondsToDecimalHours(entry.duration);
      const hoursSpentStr = roundTo15Min(hoursDecimal);

      let availableBookingTags = [];
      if (bestMatch) {
        availableBookingTags = await fetchBookingTagsForProject(bestMatch.id);
      }
      const matchedBookingTagId = matchBookingTag({ ticketId, note: title, tags: entry.tags || [] }, availableBookingTags);

      processedRows.push({
        tmetricEntry: entry,
        tmetricProjId,
        tmetricProjName,
        matchedPortalProject: bestMatch,
        availableBookingTags,
        matchedBookingTagId,
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

  // Render main review modal
  closeModal();
  const mainOverlay = document.createElement('div');
  mainOverlay.className = 'tm-modal-overlay';
  mainOverlay.innerHTML = `
    <div class="tm-modal-card">
      <div class="tm-modal-header">
        <h2>🚀 TMetric ➔ Beyonder Portal Sync</h2>
        <div>
          <button id="tm-sync-projects-btn" class="tm-btn-secondary" style="margin-right:8px;">📁 Sync Projects</button>
          <button id="tm-settings-btn" class="tm-btn-secondary" style="margin-right:8px;">⚙️ Settings</button>
          <button id="tm-close-modal" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
        </div>
      </div>
      <div class="tm-modal-body">
        <div class="tm-card-info" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <strong>Sync Mode:</strong>
            <select id="tm-mode-select" class="tm-select" style="width:auto;display:inline-block;padding:4px 8px;">
              <option value="3days" ${rangeMode === '3days' ? 'selected' : ''}>Past 3 Days</option>
              <option value="single" ${rangeMode === 'single' ? 'selected' : ''}>Single Date</option>
            </select>
            <input type="date" id="tm-base-date" class="tm-input" style="width:auto;display:inline-block;padding:4px 8px;" value="${baseDateISO}" />
          </div>
          <div>
            <button id="tm-check-all-btn" class="tm-btn-secondary" style="font-size:12px;padding:4px 10px;">Select All</button>
            <button id="tm-uncheck-all-btn" class="tm-btn-secondary" style="font-size:12px;padding:4px 10px;margin-left:4px;">Deselect All</button>
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
                  <input type="checkbox" class="tm-checkbox day-za-checkbox" id="za-chk-${dayIdx}" ${day.includeZeitabschnitt ? 'checked' : ''} />
                  <label for="za-chk-${dayIdx}" style="cursor:pointer;font-weight:600;color:#1e293b;">
                    Submit Zeitabschnitt (${day.zaInfo.startTimeStr.split(' ')[1]} - ${day.zaInfo.endTimeStr.split(' ')[1]}, Pause: ${day.zaInfo.breakTimeMins}m)
                  </label>
                </div>
              ` : '<span style="font-size:12px;color:#94a3b8;">No Zeitabschnitt data</span>'}
            </div>

            ${day.zaInfo ? `
              <div class="za-details-box" style="display:${day.includeZeitabschnitt ? 'grid' : 'none'};grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
                <div>
                  <label style="display:block;color:#64748b;margin-bottom:4px;">Startzeit</label>
                  <input type="text" class="tm-input day-za-start" value="${day.zaInfo.startTimeStr}" readonly />
                </div>
                <div>
                  <label style="display:block;color:#64748b;margin-bottom:4px;">Endzeit</label>
                  <input type="text" class="tm-input day-za-end" value="${day.zaInfo.endTimeStr}" readonly />
                </div>
                <div>
                  <label style="display:block;color:#64748b;margin-bottom:4px;">Pause (Minuten)</label>
                  <input type="number" class="tm-input day-za-break" value="${day.zaInfo.breakTimeMins}" min="0" />
                </div>
                <div>
                  <label style="display:block;color:#64748b;margin-bottom:4px;">Standort</label>
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
                    <th style="width:36px;text-align:center;">
                      <input type="checkbox" class="tm-checkbox day-select-all-checkbox" checked />
                    </th>
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
                      <td style="text-align:center;">
                        <input type="checkbox" class="tm-checkbox row-enable-checkbox" ${row.selected ? 'checked' : ''} />
                      </td>
                      <td>
                        <select class="tm-select row-project-select">
                          <option value="">-- Select Project --</option>
                          ${portalProjects.map(p => `
                            <option value="${p.id}" ${row.matchedPortalProject && String(row.matchedPortalProject.id) === String(p.id) ? 'selected' : ''}>
                              ${p.name}
                            </option>
                          `).join('')}
                        </select>
                      </td>
                      <td>
                        <select class="tm-select row-tag-select">
                          <option value="">-- Select Tag --</option>
                          ${row.availableBookingTags.map(tag => `
                            <option value="${tag.id}" ${String(row.matchedBookingTagId) === String(tag.id) ? 'selected' : ''}>
                              ${tag.name}
                            </option>
                          `).join('')}
                        </select>
                      </td>
                      <td>
                        <input type="text" class="tm-input row-ticket-input" value="${row.ticketId}" />
                      </td>
                      <td>
                        <input type="text" class="tm-input row-title-input" value="${row.title}" maxlength="100" />
                      </td>
                      <td>
                        <input type="text" class="tm-input row-hours-input" value="${row.hoursSpentStr}" style="text-align:right;" />
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p style="font-size:13px;color:#94a3b8;margin:8px 0 0 0;">No time entries for this day.</p>'}
          </div>
        `).join('')}

        <div id="tm-progress-status" style="margin-top:16px;font-weight:600;font-size:14px;"></div>
      </div>

      <div class="tm-modal-footer">
        <button id="tm-cancel-btn" class="tm-btn-secondary">Cancel</button>
        <button id="tm-submit-all-btn" class="tm-btn-primary">Approve & Sync Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(mainOverlay);
  activeModalOverlay = mainOverlay;

  // Header listeners
  mainOverlay.querySelector('#tm-close-modal').onclick = closeModal;
  mainOverlay.querySelector('#tm-cancel-btn').onclick = closeModal;
  mainOverlay.querySelector('#tm-settings-btn').onclick = () => showSettingsModal();
  mainOverlay.querySelector('#tm-sync-projects-btn').onclick = () => openProjectSyncModal();

  const modeSelect = mainOverlay.querySelector('#tm-mode-select');
  const baseDatePicker = mainOverlay.querySelector('#tm-base-date');

  modeSelect.onchange = () => openSyncSummaryModal(modeSelect.value, baseDatePicker.value);
  baseDatePicker.onchange = () => openSyncSummaryModal(modeSelect.value, baseDatePicker.value);

  // Bulk check/uncheck listeners
  mainOverlay.querySelector('#tm-check-all-btn').onclick = () => {
    mainOverlay.querySelectorAll('.row-enable-checkbox, .day-za-checkbox, .day-select-all-checkbox').forEach(chk => {
      chk.checked = true;
      chk.dispatchEvent(new Event('change'));
    });
  };

  mainOverlay.querySelector('#tm-uncheck-all-btn').onclick = () => {
    mainOverlay.querySelectorAll('.row-enable-checkbox, .day-za-checkbox, .day-select-all-checkbox').forEach(chk => {
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    });
  };

  // Attach per-day & per-row interactive listeners
  daysData.forEach((day, dayIdx) => {
    const daySec = mainOverlay.querySelector(`.tm-day-section[data-day-idx="${dayIdx}"]`);
    if (!daySec) return;

    const zaChk = daySec.querySelector('.day-za-checkbox');
    const zaBox = daySec.querySelector('.za-details-box');
    if (zaChk && zaBox) {
      zaChk.onchange = () => {
        zaBox.style.display = zaChk.checked ? 'grid' : 'none';
      };
    }

    const daySelectAll = daySec.querySelector('.day-select-all-checkbox');
    const rowCheckboxes = daySec.querySelectorAll('.row-enable-checkbox');
    if (daySelectAll) {
      daySelectAll.onchange = () => {
        rowCheckboxes.forEach(r => { r.checked = daySelectAll.checked; });
      };
    }

    // Dynamic booking tag loaders on project change
    const projectSelects = daySec.querySelectorAll('.row-project-select');
    projectSelects.forEach((select, rowIdx) => {
      select.onchange = async () => {
        const selectedProjId = select.value;
        const row = day.processedRows[rowIdx];

        if (row.tmetricProjId && selectedProjId) {
          saveProjectMapping(row.tmetricProjId, selectedProjId);
        }

        const tagSelect = daySec.querySelectorAll('.row-tag-select')[rowIdx];
        tagSelect.innerHTML = '<option value="">Loading tags...</option>';

        const tags = await fetchBookingTagsForProject(selectedProjId);
        tagSelect.innerHTML = '<option value="">-- Select Tag --</option>' +
          tags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

        const autoMatchedTag = matchBookingTag({ ticketId: row.ticketId, note: row.title }, tags);
        if (autoMatchedTag) {
          tagSelect.value = autoMatchedTag;
        }
      };
    });
  });

  // Submit Action
  const submitBtn = mainOverlay.querySelector('#tm-submit-all-btn');
  const progressStatus = mainOverlay.querySelector('#tm-progress-status');

  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';

    let totalTimesheetsSubmitted = 0;
    let totalZeitabschnitteSubmitted = 0;

    for (let dayIdx = 0; dayIdx < daysData.length; dayIdx++) {
      const day = daysData[dayIdx];
      const daySec = mainOverlay.querySelector(`.tm-day-section[data-day-idx="${dayIdx}"]`);
      if (!daySec) continue;

      const rows = daySec.querySelectorAll('tbody tr');
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const tr = rows[rowIdx];
        const isEnabled = tr.querySelector('.row-enable-checkbox').checked;
        if (!isEnabled) continue;

        const projectId = tr.querySelector('.row-project-select').value;
        const bookingTagId = tr.querySelector('.row-tag-select').value;
        const ticketId = tr.querySelector('.row-ticket-input').value.trim();
        const title = tr.querySelector('.row-title-input').value.trim();
        const hoursSpent = tr.querySelector('.row-hours-input').value.trim();

        if (!projectId) {
          progressStatus.innerHTML = `<span style="color:#dc2626;">[${day.dateISO}] Row ${rowIdx + 1}: Please select a Project.</span>`;
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          return;
        }

        progressStatus.innerHTML = `<span style="color:#0284c7;">Creating timesheet for ${day.dateISO} (${title})...</span>`;

        const ok = await postTimesheet({
          projectId,
          bookingTagId,
          ticketId,
          title,
          hoursSpent,
        });

        if (ok) totalTimesheetsSubmitted++;
      }

      // Check if Zeitabschnitt submission is enabled for this day
      const zaChk = daySec.querySelector('.day-za-checkbox');
      if (zaChk && zaChk.checked && day.zaInfo) {
        progressStatus.innerHTML = `<span style="color:#0284c7;">Creating Zeitabschnitt for ${day.dateISO}...</span>`;

        const startTimeStr = daySec.querySelector('.day-za-start').value;
        const endTimeStr = daySec.querySelector('.day-za-end').value;
        const breakTimeMins = parseInt(daySec.querySelector('.day-za-break').value, 10) || 0;
        const location = daySec.querySelector('.day-za-location').value;

        const okZA = await postZeitabschnitt({
          startTimeStr,
          endTimeStr,
          breakTimeMins,
          location,
        });

        if (okZA) totalZeitabschnitteSubmitted++;
      }
    }

    progressStatus.innerHTML = `<span style="color:#16a34a;">✅ Successfully created ${totalTimesheetsSubmitted} timesheets and ${totalZeitabschnitteSubmitted} Zeitabschnitte! Reloading...</span>`;

    setTimeout(() => {
      closeModal();
      window.location.reload();
    }, 1500);
  };
}

/**
 * Injects the trigger buttons into the Beyonder Portal page UI.
 */
export function injectSyncButton() {
  if (document.getElementById('tmetric-sync-trigger-btn')) return;

  injectStyles();

  const container = document.createElement('div');
  container.style.display = 'inline-flex';
  container.style.alignItems = 'center';

  const syncTimeBtn = document.createElement('button');
  syncTimeBtn.id = 'tmetric-sync-trigger-btn';
  syncTimeBtn.className = 'tm-sync-btn';
  syncTimeBtn.innerHTML = '🚀 Sync from TMetric';
  syncTimeBtn.onclick = () => openSyncSummaryModal('3days');

  const syncProjectsBtn = document.createElement('button');
  syncProjectsBtn.id = 'tmetric-sync-projects-trigger-btn';
  syncProjectsBtn.className = 'tm-sync-btn-secondary';
  syncProjectsBtn.innerHTML = '📁 Sync Projects to TMetric';
  syncProjectsBtn.onclick = () => openProjectSyncModal();

  container.appendChild(syncTimeBtn);
  container.appendChild(syncProjectsBtn);

  const heading = document.querySelector('h1');
  if (heading) {
    heading.appendChild(container);
    return;
  }

  const nav = document.querySelector('nav');
  if (nav) {
    nav.appendChild(container);
    return;
  }

  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.zIndex = '9999';
  document.body.appendChild(container);
}
