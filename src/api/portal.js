/**
 * Beyonder Portal DOM & Form Automation Client
 */

/**
 * Resolves a relative path to a fully-qualified absolute URL.
 * 
 * @param {string} path 
 * @returns {string} Absolute URL
 */
export function resolveUrl(path) {
  if (!path) return 'https://portal.beyonder.de/';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null')
    ? window.location.origin
    : 'https://portal.beyonder.de';
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Extracts CSRF token from page input or cookie.
 */
export function getCsrfToken() {
  const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
  if (input && input.value) return input.value;

  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : '';
}

/**
 * Gets current employee ID from DOM or fallback.
 */
export function getEmployeeId() {
  const employeeInput = document.querySelector('#id_employee');
  if (employeeInput && employeeInput.value) return employeeInput.value;
  return '';
}

/**
 * Parses available projects from `#id_project` select element on current page.
 * 
 * @returns {Array<{id: string, name: string}>}
 */
export function getPortalProjectsFromDOM() {
  const select = document.querySelector('#id_project');
  if (!select) return [];

  const options = Array.from(select.options);
  return options
    .filter(opt => opt.value && opt.value !== '')
    .map(opt => ({
      id: opt.value,
      name: opt.textContent.trim(),
    }));
}

/**
 * Fetches Buchungs-Label-Muster options for a selected project via HTMX endpoint.
 * 
 * @param {string} projectId 
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchBookingTagsForProject(projectId) {
  if (!projectId) return [];

  const csrfToken = getCsrfToken();
  const formData = new URLSearchParams();
  formData.append('project', projectId);

  const targetUrl = resolveUrl('/management/timesheet/form/pattern/htmx?form=timesheet');

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-CSRFToken': csrfToken,
        'HX-Request': 'true',
        'HX-Target': '#id_timesheet_project_booking_tag',
      },
      body: formData.toString(),
    });

    if (!response.ok) return [];

    const html = await response.text();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const select = tempDiv.querySelector('select');
    if (!select) return [];

    return Array.from(select.options)
      .filter(opt => opt.value !== '')
      .map(opt => ({
        id: opt.value,
        name: opt.textContent.trim(),
      }));
  } catch (e) {
    console.error('Failed to fetch booking tags:', e);
    return [];
  }
}

/**
 * Submits a single Timesheet entry via POST to `/management/timesheet/create/`.
 * 
 * @param {object} timesheetData
 * @returns {Promise<boolean>} Success status
 */
export async function postTimesheet(timesheetData) {
  const csrfToken = getCsrfToken();
  const employeeId = timesheetData.employee || getEmployeeId();

  const body = new URLSearchParams();
  body.append('csrfmiddlewaretoken', csrfToken);
  body.append('project', timesheetData.projectId);
  body.append('timesheet_project_booking_tag', timesheetData.bookingTagId || '');
  body.append('ticket_id', timesheetData.ticketId || '');
  body.append('title', timesheetData.title);
  body.append('employee', employeeId);
  body.append('hours_spent', timesheetData.hoursSpent); // e.g. "1,75"
  body.append('submit', 'Speichern');

  const targetUrl = resolveUrl('/management/timesheet/create/');

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });

  return response.ok || response.status === 302;
}

/**
 * Submits a Zeitabschnitt (Tracking Period) entry via POST to `/time/tracking/create/`.
 * 
 * @param {object} trackingData 
 * @returns {Promise<boolean>} Success status
 */
export async function postZeitabschnitt(trackingData) {
  const csrfToken = getCsrfToken();
  const employeeId = trackingData.employee || getEmployeeId();

  const body = new URLSearchParams();
  body.append('csrfmiddlewaretoken', csrfToken);
  body.append('start_time', trackingData.startTimeStr); // e.g. "26.05.2026 08:00"
  body.append('end_time', trackingData.endTimeStr);     // e.g. "26.05.2026 17:00"
  body.append('break_time', String(trackingData.breakTimeMins)); // e.g. "60"
  body.append('location', trackingData.location || '1'); // "1" = Home-Office, "0" = Büro
  body.append('employee', employeeId);
  body.append('referer', 'https://portal.beyonder.de/time/tracking/');
  body.append('submit', 'Speichern');

  const targetUrl = resolveUrl('/time/tracking/create/');

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': csrfToken,
    },
    body: body.toString(),
  });

  return response.ok || response.status === 302;
}

/**
 * Scrapes the "Mein Profil" URL from DOM links (e.g. "https://portal.beyonder.de/account/employee/detail/89/").
 * 
 * @returns {string|null} Full URL to user's own profile page or null
 */
export function getMyProfileUrl() {
  const links = Array.from(document.querySelectorAll('a[href*="/account/employee/detail/"]'));
  
  // 1. Look for link specifically containing "Mein Profil"
  const myProfileLink = links.find(a => a.textContent && a.textContent.includes('Mein Profil'));
  if (myProfileLink) {
    return resolveUrl(myProfileLink.getAttribute('href'));
  }

  // 2. Fallback to first employee detail link if found
  if (links.length > 0) {
    return resolveUrl(links[0].getAttribute('href'));
  }

  return null;
}

/**
 * Fetches the user's profile page and parses all assigned projects.
 * 
 * @param {typeof import('../utils/matching.js').parseProfileProjectName} parseProfileProjectNameFn 
 * @returns {Promise<Array<{ id: string, name: string, role: string, href: string }>>}
 */
export async function fetchAssignedProjectsFromProfile(parseProfileProjectNameFn) {
  const profileUrl = getMyProfileUrl();
  if (!profileUrl) throw new Error('Could not locate "Mein Profil" link in the page DOM.');

  const response = await fetch(profileUrl);
  if (!response.ok) throw new Error(`Failed to load profile page (${response.status})`);

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Find all project detail links on the user's profile page: /management/project/detail/{number}/
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

    const { name, role } = parseProfileProjectNameFn(rawText);
    if (name && !projectsMap.has(name.toLowerCase())) {
      projectsMap.set(name.toLowerCase(), {
        id: projectId,
        name,
        role,
        href: resolveUrl(href),
      });
    }
  }

  return Array.from(projectsMap.values());
}
