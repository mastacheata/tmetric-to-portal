/**
 * Matching and parsing utilities for TMetric to Beyonder Portal synchronization
 */

/**
 * Normalizes text for string matching (lowercase, removes punctuation and common suffix words).
 * 
 * @param {string} text 
 * @returns {string[]} Array of normalized word tokens
 */
export function tokenize(text) {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\säöüß-]/g, ' ')
    .replace(/\b(gmbh|co|kg|ag|de|ev|inc|ltd|support|interim|umsetzung|weiterentwicklung)\b/gi, '')
    .trim();
  return normalized.split(/\s+/).filter(w => w.length > 1);
}

/**
 * Calculates token-based Jaccard similarity score between two strings (0 to 1).
 * 
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} Score between 0 and 1
 */
export function calculateSimilarity(str1, str2) {
  const tokens1 = new Set(tokenize(str1));
  const tokens2 = new Set(tokenize(str2));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  for (const token of tokens1) {
    if (tokens2.has(token)) {
      intersection++;
    } else {
      // Partial substring check for compound German words
      for (const token2 of tokens2) {
        if (token.length > 3 && token2.length > 3 && (token.includes(token2) || token2.includes(token))) {
          intersection += 0.5;
          break;
        }
      }
    }
  }

  const union = tokens1.size + tokens2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Matches a TMetric project against a list of Beyonder Portal projects.
 * 
 * @param {string} tmetricProjectName - TMetric project name
 * @param {Array<{id: string, name: string}>} portalProjects - Available portal projects
 * @param {Record<string, string>} [savedMappings] - User-saved project ID mappings { [tmetricProjectId]: portalProjectId }
 * @param {string} [tmetricProjectId] - TMetric project ID if available
 * @returns {{ bestMatch: {id: string, name: string}|null, score: number, candidates: Array<{project: {id: string, name: string}, score: number}> }}
 */
export function matchProject(tmetricProjectName, portalProjects, savedMappings = {}, tmetricProjectId = '') {
  if (!portalProjects || portalProjects.length === 0) {
    return { bestMatch: null, score: 0, candidates: [] };
  }

  // 1. Check if user already explicitly saved a mapping
  if (tmetricProjectId && savedMappings[tmetricProjectId]) {
    const mappedPortalId = savedMappings[tmetricProjectId];
    const match = portalProjects.find(p => String(p.id) === String(mappedPortalId));
    if (match) {
      return { bestMatch: match, score: 1.0, candidates: [{ project: match, score: 1.0 }] };
    }
  }

  if (!tmetricProjectName) {
    return { bestMatch: null, score: 0, candidates: [] };
  }

  // 2. Compute similarity for all candidate portal projects
  const candidates = portalProjects
    .map(project => {
      const score = calculateSimilarity(tmetricProjectName, project.name);
      return { project, score };
    })
    .sort((a, b) => b.score - a.score);

  const bestMatch = candidates.length > 0 && candidates[0].score > 0.15 ? candidates[0].project : null;
  const bestScore = candidates.length > 0 ? candidates[0].score : 0;

  return {
    bestMatch,
    score: bestScore,
    candidates,
  };
}

/**
 * Parses a TMetric entry note or task name to extract ticket ID and leftover title.
 * Handles patterns like:
 * - "#17 Security Assessment (delivered by Defenced)" => ticketId: "17", title: "Security Assessment (delivered by Defenced)"
 * - "JIRA-104 Fix login bug" => ticketId: "JIRA-104", title: "Fix login bug"
 * - "[BE-89] Refactor API" => ticketId: "BE-89", title: "Refactor API"
 * 
 * @param {object} entry - TMetric time entry object
 * @returns {{ ticketId: string, title: string }}
 */
export function parseTicketAndTitle(entry) {
  const taskName = entry.task?.name || '';
  const taskIssueId = entry.task?.issueId || entry.task?.externalLink?.issueId || entry.task?.externalLink?.caption || '';
  const note = entry.note || entry.description || '';
  const fullText = (taskName ? `${taskName} ${note}` : note).trim();

  let ticketId = taskIssueId ? String(taskIssueId).replace(/^#/, '') : '';
  let cleanText = fullText;

  // Regex for ticket patterns at start of text:
  // e.g. #17, #JIRA-104, JIRA-104, [BE-89]
  const prefixRegex = /^(?:#([a-zA-Z0-9]+(?:-[0-9]+)?)|\[([a-zA-Z0-9-]+)\]|([a-zA-Z]+-[0-9]+))\s*[:|-]?\s*(.*)$/;
  const match = cleanText.match(prefixRegex);

  if (match) {
    if (!ticketId) {
      ticketId = match[1] || match[2] || match[3] || '';
    }
    cleanText = (match[4] || '').trim();
  }

  // Remove duplicate ticket IDs if present at start of title
  if (ticketId && cleanText.toLowerCase().startsWith(ticketId.toLowerCase())) {
    cleanText = cleanText.substring(ticketId.length).replace(/^[:|-]\s*/, '').trim();
  }

  // Truncate title to 100 characters max (Portal form limit)
  const title = cleanText.substring(0, 100).trim() || taskName || note || 'Arbeitszeit';

  return { ticketId, title };
}

/**
 * Matches Buchungs-Label-Muster (Booking Tag Pattern) for a given entry & project.
 * 
 * @param {{ ticketId: string, tags?: Array<string|{name: string}>, note?: string }} entryInfo 
 * @param {Array<{ id: string, name: string }>} availableBookingTags 
 * @returns {string} Selected booking tag ID or empty string
 */
export function matchBookingTag(entryInfo, availableBookingTags) {
  if (!availableBookingTags || availableBookingTags.length === 0) return '';

  const { ticketId, tags = [], note = '' } = entryInfo;
  const tagNames = tags.map(t => (typeof t === 'string' ? t : (t?.name || '')));

  // 1. If ticket ID exists, search for pattern containing ticket token like #[TICKET-ID] or TICKET-ID
  if (ticketId) {
    const ticketPatternMatch = availableBookingTags.find(tag =>
      tag.name.includes('#[TICKET-ID]') ||
      tag.name.toLowerCase().includes('ticket') ||
      tag.name.includes('#')
    );
    if (ticketPatternMatch) return ticketPatternMatch.id;
  }

  // 2. Match against entry tags or first word of description
  const firstWord = note.split(/\s+/)[0]?.toLowerCase() || '';
  for (const tagOption of availableBookingTags) {
    const tagNameLower = tagOption.name.toLowerCase();
    
    // Check if tagOption matches any entry tag
    if (tagNames.some(t => t && tagNameLower.includes(t.toLowerCase()))) {
      return tagOption.id;
    }
    
    // Check if tagOption matches first word
    if (firstWord && firstWord.length > 2 && tagNameLower.includes(firstWord)) {
      return tagOption.id;
    }
  }

  // 3. Fallback: return first non-empty option if only one available (or default option)
  const nonDefaultOptions = availableBookingTags.filter(t => t.id && t.id !== '');
  if (nonDefaultOptions.length === 1) {
    return nonDefaultOptions[0].id;
  }

  return '';
}

/**
 * Parses raw text from a profile project span e.g. "DVG - Konzeptsprint (IT-Architekt*in (Level 1+))"
 * to extract the clean project name and role.
 * 
 * @param {string} rawText 
 * @returns {{ name: string, role: string }}
 */
export function parseProfileProjectName(rawText) {
  if (!rawText) return { name: '', role: '' };
  const trimmed = rawText.trim();
  const match = trimmed.match(/^(.*?)(?:\s*\((.*)\))?$/);
  if (match && match[2]) {
    return { name: match[1].trim(), role: match[2].trim() };
  }
  return { name: trimmed, role: '' };
}
