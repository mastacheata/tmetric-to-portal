/**
 * Configuration and persistent storage manager for TMetric to Portal Sync
 */

const STORAGE_KEYS = {
  TMETRIC_TOKEN: 'tmetric_portal_sync_token',
  USER_ID: 'tmetric_portal_sync_user_id',
  ACCOUNT_ID: 'tmetric_portal_sync_account_id',
  PROJECT_MAPPINGS: 'tmetric_portal_sync_project_mappings', // { [tmetricProjectId]: portalProjectId }
};

/**
 * Gets a value from GM storage or localStorage fallback.
 */
export function getValue(key, defaultValue = null) {
  try {
    if (typeof GM_getValue !== 'undefined') {
      return GM_getValue(key, defaultValue);
    }
  } catch (e) {
    // Fallback
  }
  try {
    const val = localStorage.getItem(key);
    return val !== null ? JSON.parse(val) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Sets a value in GM storage or localStorage fallback.
 */
export function setValue(key, value) {
  try {
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(key, value);
      return;
    }
  } catch (e) {
    // Fallback
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

export function getTMetricToken() {
  return getValue(STORAGE_KEYS.TMETRIC_TOKEN, '');
}

export function setTMetricToken(token) {
  setValue(STORAGE_KEYS.TMETRIC_TOKEN, token ? token.trim() : '');
}

export function getTMetricUserId() {
  return getValue(STORAGE_KEYS.USER_ID, '');
}

export function setTMetricUserId(userId) {
  setValue(STORAGE_KEYS.USER_ID, userId ? String(userId) : '');
}

export function getTMetricAccountId() {
  return getValue(STORAGE_KEYS.ACCOUNT_ID, '');
}

export function setTMetricAccountId(accountId) {
  setValue(STORAGE_KEYS.ACCOUNT_ID, accountId ? String(accountId) : '');
}

export function getProjectMappings() {
  return getValue(STORAGE_KEYS.PROJECT_MAPPINGS, {});
}

export function saveProjectMapping(tmetricProjectId, portalProjectId) {
  const mappings = getProjectMappings();
  mappings[tmetricProjectId] = portalProjectId;
  setValue(STORAGE_KEYS.PROJECT_MAPPINGS, mappings);
}
