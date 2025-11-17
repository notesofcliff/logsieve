/**
 * LogSieve - Log File Analysis Tool
 * JavaScript functionality for filtering, parsing, and visualizing log data
 */

// ---------- Utilities ----------

/**
 * Simple DOM selector utility
 * @param {string} sel - CSS selector
 * @returns {Element} - DOM element
 */
const $ = (sel) => document.querySelector(sel);

/**
 * Format number with locale-specific formatting
 * @param {number} n - Number to format
 * @returns {string} - Formatted number
 */
const fmt = (n) => n.toLocaleString();

// Common log level patterns to look for
const LEVEL_HINTS = ["DEBUG", "INFO", "WARN", "WARNING", "ERROR", "CRITICAL", "FATAL"];

/**
 * Attempt to guess log level from line content
 * @param {string} line - Log line text
 * @returns {string} - Detected log level or empty string
 */
function guessLevel(line) {
  const up = line.toUpperCase();
  for (const lv of LEVEL_HINTS) {
    if (up.includes(lv)) return lv === "WARN" ? "WARNING" : lv;
  }
  return "";
}

/**
 * Extract timestamp from log line using ISO-ish pattern
 * @param {string} line - Log line text
 * @returns {string} - ISO timestamp or empty string
 */
function tryTs(line) {
  // First try ISO-ish yyyy-mm-dd[ T]hh:mm:ss(.sss)?
  const m = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/);
  if (m) {
    const raw = m[1];
    // Normalize fractional seconds separator and replace space with T for readability
    const iso = raw.replace(" ", "T").replace(",", ".");
    // Create a Date using numeric components to ensure it's treated as a local timestamp
    const parts = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
    let d;
    if (parts) {
      const [, y, mo, da, hh, mm, ss, frac] = parts;
      const ms = frac ? Math.floor(Number('0.' + frac) * 1000) : 0;
      d = new Date(Number(y), Number(mo) - 1, Number(da), Number(hh), Number(mm), Number(ss), ms);
    } else {
      d = new Date(iso);
    }
    return isNaN(d) ? "" : d.toISOString();
  }

  // Try "MMM DD HH:MM:SS" format (e.g., Oct 28 11:11:15)
  const monthMap = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  const monthDayMatch = line.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (monthDayMatch) {
    const [, monthStr, day, hour, minute, second, frac] = monthDayMatch;
    const month = monthMap[monthStr];
    if (month !== undefined) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      let year = currentYear;
      if (month > currentMonth) {
        year = currentYear - 1;
      }
      const ms = frac ? Math.floor(Number('0.' + frac) * 1000) : 0;
      const d = new Date(year, month, Number(day), Number(hour), Number(minute), Number(second), ms);
      return isNaN(d) ? "" : d.toISOString();
    }
  }

  return "";
}

/**
 * Parse various time string formats and return ISO (UTC) string or empty string.
 * For naive timestamps (no timezone) this treats them as local timestamps.
 * @param {string} s
 * @returns {string}
 */
function parseTimestampToISO(s) {
  if (!s) return '';
  const str = String(s).trim();

  // If string appears to include an explicit timezone offset or Z, let Date handle it
  if (/[zZ]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str) || /[+-]\d{2}\d{2}$/.test(str)) {
    const d = new Date(str);
    return isNaN(d) ? '' : d.toISOString();
  }

  // ISO-ish or common naive formats: yyyy-mm-dd HH:MM:SS(.sss)
  const parts = str.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (parts) {
    const [, y, mo, da, hh, mm, ss, frac] = parts;
    const ms = frac ? Math.floor(Number('0.' + frac) * 1000) : 0;
    const d = new Date(Number(y), Number(mo) - 1, Number(da), Number(hh), Number(mm), Number(ss), ms);
    return isNaN(d) ? '' : d.toISOString();
  }

  // Handle "MMM DD HH:MM:SS" format (e.g., Oct 28 11:11:15)
  const monthMap = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  const monthDayParts = str.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (monthDayParts) {
    const [, monthStr, day, hour, minute, second, frac] = monthDayParts;
    const month = monthMap[monthStr];
    if (month !== undefined) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      let year = currentYear;
      if (month > currentMonth) {
        year = currentYear - 1;
      }
      const ms = frac ? Math.floor(Number('0.' + frac) * 1000) : 0;
      const d = new Date(year, month, Number(day), Number(hour), Number(minute), Number(second), ms);
      return isNaN(d) ? '' : d.toISOString();
    }
  }

  // Fallback to Date
  const d = new Date(str);
  return isNaN(d) ? '' : d.toISOString();
}

// Format an ISO or raw timestamp string to user's localized datetime with tz
function formatLocalDatetime(isoOrRaw) {
  if (!isoOrRaw) return '';
  // Already an ISO or attempt to parse to ISO (works for Z and naive local)
  const iso = parseTimestampToISO(isoOrRaw) || String(isoOrRaw);
  const d = new Date(iso);
  if (isNaN(d)) return String(isoOrRaw);
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' };
  // Remove comma placed by locales and return a consistent format
  return d.toLocaleString(undefined, opts).replace(',', '');
}

/**
 * Remove timestamp prefix from log line
 * @param {string} line - Log line text
 * @returns {string} - Line without timestamp prefix
 */
function stripPrefix(line) {
  // First try to remove ISO-style timestamps
  let result = line.replace(/^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/, "");
  
  // If no ISO timestamp was removed, try to remove "MMM DD HH:MM:SS" format
  if (result === line) {
    result = line.replace(/^\s*\[?[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/, "");
  }
  
  return result;
}

/**
 * Check if a line starts a new exception event (even without timestamp)
 * These patterns indicate standalone exception entries
 * @param {string} line - Log line text
 * @returns {boolean} - True if line starts a new exception
 */
function isExceptionStart(line) {
  const trimmed = line.trim();
  
  // Java-style: Exception in thread "..." 
  if (/^Exception in thread/i.test(trimmed)) {
    return true;
  }
  
  // Generic exception with colon at start of line (not indented)
  if (!line.startsWith(' ') && !line.startsWith('\t')) {
    if (/^\S+Error:/.test(trimmed) || /^\S+Exception:/.test(trimmed)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a line is a continuation line (part of a multi-line event)
 * Continuation lines are typically:
 * - Stack trace lines (starting with whitespace + "at", "File", etc.)
 * - Exception lines (starting with common exception types)
 * - Lines that don't have a timestamp and start with whitespace
 * @param {string} line - Log line text
 * @returns {boolean} - True if line is a continuation line
 */
function isContinuationLine(line) {
  if (!line.trim()) return false;
  
  // Check if line has a timestamp (if yes, it's a new event)
  if (/^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(line) || /^\s*\[?[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/.test(line)) {
    return false;
  }
  
  // Check if this starts a new exception event
  if (isExceptionStart(line)) {
    return false;
  }
  
  // Common patterns for continuation lines:
  // 1. Traceback indicator
  if (/^Traceback \(most recent call last\):?/i.test(line.trim())) {
    return true;
  }
  
  // 2. Python stack frame (starts with whitespace + "File")
  if (/^\s+File .*line \d+/i.test(line)) {
    return true;
  }
  
  // 3. Python exception types (indented or as part of traceback)
  if (/^\s+\S+Error:/.test(line) || /^\s+\S+Exception:/.test(line)) {
    return true;
  }
  
  // 4. Java/JavaScript stack trace (starts with whitespace + "at")
  if (/^\s+at /.test(line)) {
    return true;
  }
  
  // 5. Indented continuation (starts with tab or multiple spaces)
  if (/^[\t ]{2,}/.test(line)) {
    return true;
  }
  
  // 6. Exception location info (starts with whitespace)
  if (/^\s+/.test(line) && line.trim().length > 0) {
    return true;
  }
  
  return false;
}

/**
 * Tokenize string for search purposes
 * @param {string} s - String to tokenize
 * @returns {Array<string>} - Array of tokens
 */
function tokenize(s) {
  return s.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}

// ---------- Storage Manager ----------

/**
 * Generate a simple UUID v4
 * @returns {string} - UUID string
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Storage manager for localStorage operations
 */
const Storage = {
  KEYS: {
    EXTRACTORS: 'logsieve-extractors',
    FILTERS: 'logsieve-filters',
    ACTIVE_EXTRACTORS: 'logsieve-active-extractors',
    PREFS: 'logsieve-prefs',
    THEME: 'logsieve-theme'
  },

  /**
   * Get all saved extractors
   * @returns {Array<Object>} - Array of extractor objects
   */
  getExtractors() {
    try {
      const data = localStorage.getItem(this.KEYS.EXTRACTORS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load extractors:', e);
      return [];
    }
  },

  /**
   * Save an extractor (create or update)
   * @param {Object} extractor - Extractor object
   * @returns {Object} - Saved extractor with id
   */
  saveExtractor(extractor) {
    const extractors = this.getExtractors();
    
    if (!extractor.id) {
      extractor.id = generateUUID();
      extractor.created = new Date().toISOString();
    }
    extractor.updated = new Date().toISOString();

    const idx = extractors.findIndex(e => e.id === extractor.id);
    if (idx >= 0) {
      extractors[idx] = extractor;
    } else {
      extractors.push(extractor);
    }

    localStorage.setItem(this.KEYS.EXTRACTORS, JSON.stringify(extractors));
    return extractor;
  },

  /**
   * Delete an extractor by id
   * @param {string} id - Extractor id
   */
  deleteExtractor(id) {
    const extractors = this.getExtractors().filter(e => e.id !== id);
    localStorage.setItem(this.KEYS.EXTRACTORS, JSON.stringify(extractors));
    
    // Remove from active list if present
    const active = this.getActiveExtractors().filter(aid => aid !== id);
    this.setActiveExtractors(active);
  },

  /**
   * Get active extractor IDs
   * @returns {Array<string>} - Array of active extractor IDs
   */
  getActiveExtractors() {
    try {
      const data = localStorage.getItem(this.KEYS.ACTIVE_EXTRACTORS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load active extractors:', e);
      return [];
    }
  },

  /**
   * Set active extractor IDs
   * @param {Array<string>} ids - Array of extractor IDs
   */
  setActiveExtractors(ids) {
    // Deduplicate and clean up IDs
    const uniqueIds = [...new Set(ids)];
    const validExtractors = this.getExtractors();
    const validIds = uniqueIds.filter(id => validExtractors.some(e => e.id === id));
    localStorage.setItem(this.KEYS.ACTIVE_EXTRACTORS, JSON.stringify(validIds));
  },

  /**
   * Get all saved filters
   * @returns {Array<Object>} - Array of filter objects
   */
  getFilters() {
    try {
      const data = localStorage.getItem(this.KEYS.FILTERS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load filters:', e);
      return [];
    }
  },

  /**
   * Save a filter (create or update)
   * @param {Object} filter - Filter object
   * @returns {Object} - Saved filter with id
   */
  saveFilter(filter) {
    const filters = this.getFilters();
    
    if (!filter.id) {
      filter.id = generateUUID();
      filter.created = new Date().toISOString();
    }
    filter.updated = new Date().toISOString();

    const idx = filters.findIndex(f => f.id === filter.id);
    if (idx >= 0) {
      filters[idx] = filter;
    } else {
      filters.push(filter);
    }

    localStorage.setItem(this.KEYS.FILTERS, JSON.stringify(filters));
    return filter;
  },

  /**
   * Delete a filter by id
   * @param {string} id - Filter id
   */
  deleteFilter(id) {
    const filters = this.getFilters().filter(f => f.id !== id);
    localStorage.setItem(this.KEYS.FILTERS, JSON.stringify(filters));
  },

  /**
   * Get user preferences
   * @returns {Object} - Preferences object
   */
  getPrefs() {
    try {
      const data = localStorage.getItem(this.KEYS.PREFS);
      return data ? JSON.parse(data) : {
        defaultPageSize: 50,
        extractorMergeStrategy: 'last-wins'
      };
    } catch (e) {
      console.error('Failed to load preferences:', e);
      return { defaultPageSize: 50, extractorMergeStrategy: 'last-wins' };
    }
  },

  /**
   * Save user preferences
   * @param {Object} prefs - Preferences object
   */
  savePrefs(prefs) {
    localStorage.setItem(this.KEYS.PREFS, JSON.stringify(prefs));
  },

  /**
   * Export all data
   * @returns {Object} - All stored data
   */
  exportAll() {
    return {
      extractors: this.getExtractors(),
      filters: this.getFilters(),
      activeExtractors: this.getActiveExtractors(),
      prefs: this.getPrefs(),
      exportDate: new Date().toISOString(),
      version: '1.0'
    };
  },

  /**
   * Import data with merge option
   * @param {Object} data - Data to import
   * @param {boolean} merge - Whether to merge with existing data
   * @returns {Object} - Import results
   */
  importAll(data, merge = true) {
    const results = { extractors: 0, filters: 0, errors: [] };

    try {
      if (data.extractors) {
        const existing = merge ? this.getExtractors() : [];
        const imported = data.extractors.map(e => {
          // Generate new ID if merging to avoid conflicts
          if (merge) e.id = generateUUID();
          return e;
        });
        localStorage.setItem(this.KEYS.EXTRACTORS, JSON.stringify([...existing, ...imported]));
        results.extractors = imported.length;
      }

      if (data.filters) {
        const existing = merge ? this.getFilters() : [];
        const imported = data.filters.map(f => {
          if (merge) f.id = generateUUID();
          return f;
        });
        localStorage.setItem(this.KEYS.FILTERS, JSON.stringify([...existing, ...imported]));
        results.filters = imported.length;
      }

      if (data.prefs && !merge) {
        this.savePrefs(data.prefs);
      }
    } catch (e) {
      results.errors.push(e.message);
    }

    return results;
  }
};

// ---------- Data Model ----------

let rows = [];        // Full dataset
let view = [];        // Filtered/sorted view
let page = 1;         // Current page number
let per = 50;         // Items per page
let totalRows = 0;    // Total rows in filtered view
let fieldNames = new Set();  // Track all extracted field names
let currentFilterConfig = null;
let builderOpen = true; // make builder primary and visible by default
// applied* states capture what was last applied with the Apply button
let appliedFilterConfig = null;
let appliedAdvancedQuery = null;
// Detected user's timezone name (IANA). Set at startup for consistent rendering
const userTimeZone = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Local';

// ---------- Worker Communication ----------

let worker = null;
let pendingRequests = new Map(); // Track pending worker requests

/**
 * Initialize the WebWorker
 */
function initWorker() {
  if (worker) return; // Already initialized

  worker = new Worker('logsieve-worker.js');
  worker.onmessage = handleWorkerMessage;
  worker.onerror = handleWorkerError;
}

/**
 * Handle messages from the worker
 */
function handleWorkerMessage(e) {
  const { type, data, id } = e.data;

  // Resolve pending request if this is a response to a specific request
  if (id && pendingRequests.has(id)) {
    const resolve = pendingRequests.get(id);
    pendingRequests.delete(id);
    resolve({ type, data });
    return;
  }

  // Handle unsolicited messages
  switch (type) {
    case 'PARSE_COMPLETE':
      rows = data.rows || [];
      fieldNames = new Set(data.fieldNames || []);
      FieldRegistry.updateFromDataset(rows);
      $("#info").textContent = `Parsed ${fmt(rows.length)} entries`;
      $("#uploadProgress").style.display = 'none';
  // After parsing completes and results are displayed, collapse the Upload section and open Results
  const uploadSection = document.getElementById('section-upload');
  if (uploadSection) uploadSection.classList.remove('active');
  // Set Results nav active for clarity
  navigateToSection('results');
      applyFilters();
      break;

    case 'FILTER_COMPLETE':
      view = data.view || [];
      page = 1; // Reset to first page
      totalRows = data.viewLength || 0; // Store total rows for pagination
      $("#filterProgress").style.display = 'none';
      $("#savedFilterProgress").style.display = 'none';
      render();
      break;

    case 'EXTRACTORS_COMPLETE':
      fieldNames = new Set(data.newFieldNames || []);
      FieldRegistry.updateFromDataset(rows);
      $("#extractInfo").textContent = `Applied extractors · ${fmt(data.results.total)} matches`;
      $("#extractorProgress").style.display = 'none';
      updateSortOptions();
      renderQueryFields();
      applyFilters();
      break;

    case 'PAGE_DATA':
      // Handle paginated data for rendering
      renderPage(data);
      break;

    case 'STATS_DATA':
      renderStatsFromWorker(data);
      break;

    case 'FULL_VIEW_DATA':
      // This is handled by the pending request resolver
      break;

    case 'PARSE_QUERY_RESULT':
      // This is handled by the pending request resolver
      break;

    case 'PROGRESS':
      const { percent, message, operation } = data;
      if (operation === 'parsing') {
        const container = $("#uploadProgress");
        const fill = $("#uploadProgressFill");
        const text = $("#uploadProgressText");
        container.style.display = 'block';
        fill.style.width = percent + '%';
        text.textContent = message;
      } else if (operation === 'extracting') {
        const container = $("#extractorProgress");
        const fill = $("#extractorProgressFill");
        const text = $("#extractorProgressText");
        container.style.display = 'block';
        fill.style.width = percent + '%';
        text.textContent = message;
      } else if (operation === 'filtering') {
        const container = $("#filterProgress");
        const fill = $("#filterProgressFill");
        const text = $("#filterProgressText");
        container.style.display = 'block';
        fill.style.width = percent + '%';
        text.textContent = message;
      } else if (operation === 'saved-filtering') {
        const container = $("#savedFilterProgress");
        const fill = $("#savedFilterProgressFill");
        const text = $("#savedFilterProgressText");
        container.style.display = 'block';
        fill.style.width = percent + '%';
        text.textContent = message;
      }
      break;

    case 'ERROR':
      console.error('Worker error:', data.message);
      alert('Processing error: ' + data.message);
      break;

    default:
      console.warn('Unknown worker message type:', type);
  }
}

/**
 * Handle worker errors
 */
function handleWorkerError(error) {
  console.error('Worker error:', error);
  alert('Worker error: ' + error.message);
}

/**
 * Send a message to the worker and optionally wait for response
 */
function sendToWorker(type, data, waitForResponse = false) {
  if (!worker) {
    throw new Error('Worker not initialized');
  }

  // Ensure data is serializable by deep cloning
  const serializableData = (() => {
    try {
      const str = JSON.stringify(data);
      return str === undefined ? null : JSON.parse(str);
    } catch (e) {
      console.error('Data not serializable, using null', data, e);
      return null;
    }
  })();
  const message = { type, data: serializableData };
  if (waitForResponse) {
    const id = generateUUID();
    message.id = id;
    return new Promise((resolve) => {
      pendingRequests.set(id, resolve);
      worker.postMessage(message);
    });
  } else {
    worker.postMessage(message);
  }
}

// ---------- Field Registry & Operators (Phase 1) ----------

const OPERATORS = {
  text: [
    { value: 'equals', label: 'equals', fn: (a, b) => String(a) === String(b) },
    { value: 'notEquals', label: 'does not equal', fn: (a, b) => String(a) !== String(b) },
    { value: 'contains', label: 'contains', fn: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()) },
    { value: 'notContains', label: 'does not contain', fn: (a, b) => !String(a).toLowerCase().includes(String(b).toLowerCase()) },
    { value: 'startsWith', label: 'starts with', fn: (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase()) },
    { value: 'endsWith', label: 'ends with', fn: (a, b) => String(a).toLowerCase().endsWith(String(b).toLowerCase()) },
    { value: 'matches', label: 'matches regex', fn: (a, b) => new RegExp(b, 'i').test(a) },
    { value: 'empty', label: 'is empty', fn: (a) => !a || (Array.isArray(a) && a.length === 0) },
    { value: 'notEmpty', label: 'is not empty', fn: (a) => !!a && (!Array.isArray(a) || a.length > 0) }
  ],
  numeric: [
    { value: 'equals', label: '=', fn: (a, b) => parseFloat(a) === parseFloat(b) },
    { value: 'notEquals', label: '≠', fn: (a, b) => parseFloat(a) !== parseFloat(b) },
    { value: 'greaterThan', label: '>', fn: (a, b) => parseFloat(a) > parseFloat(b) },
    { value: 'greaterOrEqual', label: '≥', fn: (a, b) => parseFloat(a) >= parseFloat(b) },
    { value: 'lessThan', label: '<', fn: (a, b) => parseFloat(a) < parseFloat(b) },
    { value: 'lessOrEqual', label: '≤', fn: (a, b) => parseFloat(a) <= parseFloat(b) }
  ],
  date: [
    { value: 'before', label: 'before', fn: (a, b) => {
      const aa = parseTimestampToISO(a) || a;
      const bb = parseTimestampToISO(b) || b;
      const da = new Date(aa);
      const db = new Date(bb);
      if (isNaN(da) || isNaN(db)) return false;
      return da < db;
    }},
    { value: 'after', label: 'after', fn: (a, b) => {
      const aa = parseTimestampToISO(a) || a;
      const bb = parseTimestampToISO(b) || b;
      const da = new Date(aa);
      const db = new Date(bb);
      if (isNaN(da) || isNaN(db)) return false;
      return da > db;
    }},
    { value: 'between', label: 'between', fn: (a, b) => {
      const aa = parseTimestampToISO(a) || a;
      const date = new Date(aa);
      const parts = (b || '').split(',');
      if (parts.length < 2) return false;
      const start = new Date(parseTimestampToISO(parts[0]) || parts[0]);
      const end = new Date(parseTimestampToISO(parts[1]) || parts[1]);
      if (isNaN(date) || isNaN(start) || isNaN(end)) return false;
      return date >= start && date <= end;
    }},
    { value: 'equals', label: 'on', fn: (a,b) => {
      const aa = parseTimestampToISO(a) || a;
      const bb = parseTimestampToISO(b) || b;
      const da = new Date(aa);
      const db = new Date(bb);
      if (isNaN(da) || isNaN(db)) return false;
      return da.toISOString().split('T')[0] === db.toISOString().split('T')[0];
    }}
  ],
  array: [
    { value: 'contains', label: 'contains', fn: (arr, val) => Array.isArray(arr) && arr.some(v => String(v).toLowerCase().includes(String(val).toLowerCase())) },
    { value: 'containsAll', label: 'contains all', fn: (arr, val) => {
      const values = String(val).split(',').map(v => v.trim());
      return values.every(v => Array.isArray(arr) && arr.some(av => String(av).toLowerCase().includes(v.toLowerCase())));
    }},
    { value: 'containsAny', label: 'contains any', fn: (arr, val) => {
      const values = String(val).split(',').map(v => v.trim());
      return values.some(v => Array.isArray(arr) && arr.some(av => String(av).toLowerCase().includes(v.toLowerCase())));
    }},
    { value: 'empty', label: 'is empty', fn: (arr) => !arr || arr.length === 0 },
    { value: 'notEmpty', label: 'is not empty', fn: (arr) => !!arr && arr.length > 0 }
  ]
};

const FieldRegistry = {
  fields: new Map(),
  register(fieldName, samples = []) {
    const existing = this.fields.get(fieldName) || { name: fieldName, type: 'text', samples: [], uniqueValues: new Set(), isNumeric: false, isDate: false, isArray: false };
    samples.forEach(sample => {
      if (sample !== null && sample !== undefined) {
        existing.samples.push(sample);
        existing.uniqueValues.add(String(sample));
      }
    });
    if (existing.samples.length > 100) existing.samples = existing.samples.slice(-100);
    this._detectType(existing);
    this.fields.set(fieldName, existing);
  },
  _detectType(field) {
    if (field.samples.length === 0) return;
    field.isArray = field.samples.some(s => Array.isArray(s));
    if (field.isArray) { field.type = 'array'; return; }
    const numericSamples = field.samples.filter(s => !isNaN(parseFloat(s)) && isFinite(s));
    field.isNumeric = numericSamples.length / field.samples.length > 0.8;
    if (field.isNumeric) { field.type = 'numeric'; return; }
    const dateSamples = field.samples.filter(s => { const d = new Date(s); return !isNaN(d) && String(s).length >= 8; });
    field.isDate = dateSamples.length / field.samples.length > 0.8;
    if (field.isDate) { field.type = 'date'; return; }
    field.type = 'text';
  },
  get(fieldName) { return this.fields.get(fieldName); },
  getUniqueValues(fieldName, limit = 100) { const f = this.get(fieldName); return !f ? [] : Array.from(f.uniqueValues).slice(0, limit).sort(); },
  updateFromDataset(rows) {
    this.fields.clear();
    this.register('level', rows.map(r => r.level).filter(Boolean));
    this.register('ts', rows.map(r => r.ts).filter(Boolean));
    this.register('message', rows.map(r => r.message).filter(Boolean));
    const fNames = new Set();
    rows.forEach(row => { if (row.fields) Object.keys(row.fields).forEach(key => fNames.add(key)); });
    fNames.forEach(fn => {
      const samples = rows.map(r => r.fields?.[fn]).filter(v => v !== null && v !== undefined).slice(0, 100);
      this.register(fn, samples);
    });
  }
};

function getOperatorsForField(fieldName, fieldValue) {
  if (fieldName === 'level') return OPERATORS.text.filter(op => ['equals', 'notEquals'].includes(op.value));
  if (fieldName === 'ts' || fieldName === 'timestamp') return OPERATORS.date;
  if (Array.isArray(fieldValue)) return OPERATORS.array;
  if (!isNaN(parseFloat(fieldValue)) && isFinite(fieldValue)) return OPERATORS.numeric;
  return OPERATORS.text;
}

/**
 * Evaluate a single filter rule against a row
 */
function evaluateRule(row, rule) {
  if (!rule || rule.enabled === false) return true;
  let fieldValue;
  if (['level', 'ts', 'message', 'raw', 'id'].includes(rule.field)) fieldValue = row[rule.field];
  else fieldValue = row.fields?.[rule.field];
  // Treat empty-string or empty-array as empty for the "empty" operator
  const isEmpty = fieldValue === undefined || fieldValue === null || (typeof fieldValue === 'string' && fieldValue.trim() === '') || (Array.isArray(fieldValue) && fieldValue.length === 0);
  if (isEmpty) {
    if (rule.operator === 'empty') return true;
    if (rule.operator === 'notEmpty') return false;
    // For other operators, no value to compare against -> rule does not match
    return false;
  }

  // If the rule requires a value but rule.value is empty, do not try expensive comparisons
  if (rule.value === undefined || rule.value === null || String(rule.value).trim() === '') {
    if (rule.operator === 'empty') return false; // already handled, but just in case
    if (rule.operator === 'notEmpty') return true;
    // No comparison value
    return false;
  }
    
  const fieldMeta = FieldRegistry.get(rule.field);
  const fieldType = fieldMeta?.type || (Array.isArray(fieldValue) ? 'array' : 'text');
  const operators = OPERATORS[fieldType] || OPERATORS.text;
  const operator = operators.find(op => op.value === rule.operator);
  if (!operator) { console.warn('Unknown operator', rule.operator); return true; }
  try { return operator.fn(fieldValue, rule.value); } catch (e) { console.error('Error evaluating rule', rule, e); return false; }
}

function evaluateRules(row, rules) {
  if (!rules || rules.length === 0) return true;
  let result = evaluateRule(row, rules[0]);
  for (let i = 1; i < rules.length; i++) {
    const rule = rules[i];
    const prevLogic = rules[i - 1].logic || 'AND';
    const ruleResult = evaluateRule(row, rule);
    if (prevLogic === 'AND') result = result && ruleResult;
    else if (prevLogic === 'OR') result = result || ruleResult;
    if (!result && prevLogic === 'AND') {
      const hasOrAhead = rules.slice(i).some(r => r.logic === 'OR');
      if (!hasOrAhead) break;
    }
  }
  return result;
}

function applyFilterConfig(rows, filterConfig) {
  let filteredRows = rows;
  if (filterConfig.quickSearch && filterConfig.quickSearch.trim()) {
    const terms = filterConfig.quickSearch.toLowerCase().split(/\s+/);
    filteredRows = filteredRows.filter(row => terms.every(t => row._lc.includes(t)));
  }
  if (filterConfig.rules && filterConfig.rules.length > 0) {
    filteredRows = filteredRows.filter(row => evaluateRules(row, filterConfig.rules));
  }
  if (filterConfig.groups && filterConfig.groups.length > 0) {
    filterConfig.groups.forEach(group => {
      const groupMatches = filteredRows.filter(row => evaluateRules(row, group.rules));
      if (group.logic === 'OR') {
        filteredRows = [...new Set([...filteredRows, ...groupMatches])];
      } else if (group.logic === 'AND') {
        filteredRows = filteredRows.filter(row => groupMatches.includes(row));
      }
    });
  }
  return filteredRows;
}

/**
 * Migrate v1 filter to v2 format
 */
function migrateFilter(oldFilter) {
  if (!oldFilter) return oldFilter;
  if (oldFilter.version === 2) return oldFilter;
  const rules = [];
  if (oldFilter.level) {
    rules.push({ id: generateUUID(), field: 'level', operator: 'equals', value: oldFilter.level, logic: 'AND', enabled: true });
  }
  if (oldFilter.from) rules.push({ id: generateUUID(), field: 'ts', operator: 'after', value: oldFilter.from, logic: 'AND', enabled: true });
  if (oldFilter.to) rules.push({ id: generateUUID(), field: 'ts', operator: 'before', value: oldFilter.to, logic: 'AND', enabled: true });
  if (rules.length > 0) rules[rules.length - 1].logic = null;
  return { ...oldFilter, version: 2, quickSearch: oldFilter.query || '', rules, sort: { field: oldFilter.sort || 'id', order: oldFilter.order || 'desc' }, _legacy: { query: oldFilter.query, regex: oldFilter.regex } };
}

function migrateAllFilters() {
  const filters = Storage.getFilters();
  let migrated = 0;
  filters.forEach(filter => { if (!filter.version || filter.version !== 2) { const v2 = migrateFilter(filter); Storage.saveFilter(v2); migrated++; } });
  if (migrated > 0) console.log(`Migrated ${migrated} filters to v2 format`);
}


/**
 * Apply all active filters to the dataset
 */
function applyFilters(operation = 'filtering') {
  // Builder rules are stored in currentFilterConfig

  const sortConfig = {
    field: $("#sort").value,
    order: $("#order").value
  };

  const filterConfig = {
    builder: appliedFilterConfig,
    advanced: appliedAdvancedQuery,
    sort: sortConfig,
    operation
  };

  sendToWorker('APPLY_FILTERS', filterConfig);
}

/**
 * Get current page of results based on pagination settings
 * @param {Array} list - List to paginate
 * @returns {Array} - Current page items
 */
function paginate(list) {
  per = +$("#per").value;
  const start = (page - 1) * per;
  return list.slice(start, start + per);
}

/**
 * Render the current view to the UI
 */
function render() {
  // Request current page data from worker
  sendToWorker('GET_PAGE', { page, per });
}

/**
 * Render a specific page of data
 */
function renderPage(pageData) {
  const t0 = performance.now();
  const body = $("#tbody");
  const theadRow = $("#thead-row");
  body.innerHTML = "";

  // Update table headers with dynamic field columns
  const sortedFields = [...fieldNames].sort();
  theadRow.innerHTML = `
    <th style="width:72px">ID</th>
  <th style="width:210px">Timestamp (<span id="tzLabel">${escapeHtml(userTimeZone)}</span>)</th>
    <th style="width:120px">Level</th>
    <th style="max-width:80ch">Message</th>
    ${sortedFields.map(f => `<th style="width:150px">${escapeHtml(f)}</th>`).join('')}
  `;

  const pageRows = pageData.pageRows;
  const frag = document.createDocumentFragment();

  for (const r of pageRows) {
    const tr = document.createElement('tr');

    // Build field cells - format arrays nicely
    const fieldCells = sortedFields.map(fieldName => {
      const val = r.fields?.[fieldName];
      if (!val) return '<td></td>';
      if (Array.isArray(val)) {
        if (val.length === 1) {
          return `<td>${escapeHtml(val[0])}</td>`;
        } else {
          return `<td><code>${escapeHtml(JSON.stringify(val))}</code></td>`;
        }
      }
      return `<td>${escapeHtml(String(val))}</td>`;
    }).join('');

    tr.innerHTML = `
      <td>${r.id}</td>
    <td>${formatLocalDatetime(r.ts) || ''}</td>
      <td><span class="lvl-${r.level}">${r.level || ''}</span></td>
      <td><pre>${escapeHtml(r.message)}</pre><details><summary>raw</summary><pre>${escapeHtml(r.raw)}</pre></details></td>
      ${fieldCells}`;
    frag.appendChild(tr);
  }

  body.appendChild(frag);

  // Update UI elements
  $("#pageLabel").textContent = `${pageData.currentPage} / ${pageData.totalPages}`;
  $("#renderInfo").textContent = `${fmt(pageData.totalRows)} rows · showing ${fmt(pageRows.length)} · ${Math.round(performance.now() - t0)}ms`;
  $("#countTag").textContent = `${fmt(pageData.totalRows)} lines`;

  // Store total rows for pagination calculations
  totalRows = pageData.totalRows;
  // Request stats separately
  sendToWorker('GET_STATS');
}

/**
 * Update the filter status tag
 */
function updateFilterTag() {
  const bits = [];
  if (currentFilterConfig && currentFilterConfig.rules && currentFilterConfig.rules.length) bits.push('builder');
  if (appliedAdvancedQuery && appliedAdvancedQuery.rules && appliedAdvancedQuery.rules.length) bits.push('advanced');
  $("#filterTag").textContent = bits.length ? `filters: ${bits.join(',')}` : 'no filters';
}

/**
 * Render statistics and sparkline chart
 */
function renderStats() {
  // Stats are now requested separately and handled in renderStatsFromWorker
}

/**
 * Render statistics from worker data
 */
function renderStatsFromWorker(stats) {
  $("#sRows").textContent = fmt(stats.totalRows);
  $("#sInfo").textContent = fmt(stats.infoCount);
  $("#sWarn").textContent = fmt(stats.warnCount);
  $("#sErr").textContent = fmt(stats.errorCount);

  // Create time-bucket sparkline (per minute)
  drawSpark($("#spark"), stats.timeBuckets);
}

/**
 * Draw sparkline chart on canvas
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Array<number>} arr - Data points to plot
 */
function drawSpark(canvas, arr) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;

  ctx.clearRect(0, 0, w, h);
  if (!arr.length) return;

  const max = Math.max(...arr);
  const min = 0;
  const step = w / Math.max(1, arr.length - 1);

  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.globalAlpha = .9;
  ctx.beginPath();

  arr.forEach((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / (max - min || 1)) * (h - 6 * devicePixelRatio) - 3 * devicePixelRatio;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  ctx.stroke();
}

/**
 * Escape HTML special characters
 * @param {string} s - String to escape
 * @returns {string} - HTML-escaped string
 */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}

// ---------- Pattern Extractor ----------

/**
 * Run a single extractor pattern on log data
 * @param {string} pattern - Regex pattern with named groups
 * @param {Array} scope - Array of log rows to process
 * @param {string} mergeStrategy - How to merge fields: 'last-wins', 'first-wins', 'merge'
 * @returns {number} - Number of rows with captures
 */
function runSingleExtractor(pattern, scope, mergeStrategy = 'last-wins') {
  let re;
  try {
    // Create regex with global flag for matchAll
    // Patterns are stored as plain strings without delimiters
    re = new RegExp(pattern, 'g');
  } catch (e) {
    console.error('Invalid regex:', e.message, 'Pattern:', pattern);
    return 0;
  }

  let hits = 0;

  for (const r of scope) {
    // Use matchAll to get all occurrences
    const matches = [...r.raw.matchAll(re)];
    if (matches.length === 0) continue;

    // Collect all captures for each named group
    const groupValues = {};
    for (const m of matches) {
      const g = m.groups || {};
      for (const [key, val] of Object.entries(g)) {
        if (!groupValues[key]) groupValues[key] = [];
        groupValues[key].push(val);
      }
    }

    if (Object.keys(groupValues).length === 0) continue;

    // Apply merge strategy for fields
    if (mergeStrategy === 'last-wins') {
      r.fields = Object.assign({}, r.fields, groupValues);
    } else if (mergeStrategy === 'first-wins') {
      // Only add fields that don't exist
      for (const [key, val] of Object.entries(groupValues)) {
        if (!(key in r.fields)) {
          r.fields[key] = val;
        }
      }
    } else if (mergeStrategy === 'merge') {
      r.fields = Object.assign({}, r.fields, groupValues);
    }

    hits++;

    // Track field names for dynamic columns
    for (const key of Object.keys(groupValues)) {
      if (key !== 'ts' && key !== 'level' && key !== 'message') {
        fieldNames.add(key);
      }
    }

    // Update structured fields if captured (use first match for these)
    if (groupValues.ts && groupValues.ts.length > 0) {
      const iso = parseTimestampToISO(groupValues.ts[0]);
      if (iso) r.ts = iso;
    }
    if (groupValues.level && groupValues.level.length > 0) {
      r.level = String(groupValues.level[0]).toUpperCase();
      if (r.level === 'WARN') r.level = 'WARNING';
    }
    if (groupValues.message && groupValues.message.length > 0) {
      r.message = groupValues.message[0];
    }
  }

  return hits;
}

/**
 * Run multiple extractors on log data
 * @param {Array<Object>} extractors - Array of extractor objects
 * @param {Array} scope - Array of log rows to process
 * @returns {Object} - Results summary
 */
function runMultipleExtractors(extractors, scope) {
  const prefs = Storage.getPrefs();
  const mergeStrategy = prefs.extractorMergeStrategy || 'last-wins';
  
  const results = {
    total: 0,
    byExtractor: {}
  };

  // Sort by order if available, otherwise by creation date
  const sorted = extractors.slice().sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    return (a.created || '').localeCompare(b.created || '');
  });

  for (const extractor of sorted) {
    // if (extractor.enabled === false) {
    //   console.log('Skipping disabled extractor:', extractor.name);
    //   continue;
    // }
    
    console.log('Running extractor:', extractor.name, 'Pattern:', extractor.pattern);
    const hits = runSingleExtractor(extractor.pattern, scope, mergeStrategy);
    console.log('Extractor', extractor.name, 'matched', hits, 'rows');
    results.byExtractor[extractor.id] = hits;
    results.total += hits;
  }

  return results;
}

/**
 * Update sort dropdown with extracted field names
 */
function updateSortOptions() {
  const sortSelect = $("#sort");
  const currentValue = sortSelect.value;
  const sortedFields = [...fieldNames].sort();
  
  // Rebuild options
  sortSelect.innerHTML = `
    <option value="id">ID</option>
    <option value="ts">Timestamp</option>
    <option value="level">Level</option>
    ${sortedFields.map(f => `<option value="field:${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')}
  `;
  
  // Restore previous selection if still valid
  const options = [...sortSelect.options];
  if (options.some(opt => opt.value === currentValue)) {
    sortSelect.value = currentValue;
  }
}

/**
 * Run active extractors from storage
 */
function runActiveExtractors() {
  const activeIds = Storage.getActiveExtractors();
  console.log('Active extractor IDs:', activeIds);

  if (activeIds.length === 0) {
    $("#extractInfo").textContent = 'No active extractors';
    return;
  }

  const allExtractors = Storage.getExtractors();
  const activeExtractors = allExtractors.filter(e => activeIds.includes(e.id));

  console.log('Found active extractors:', activeExtractors.length, 'of', allExtractors.length, 'total');
  console.log('Active extractors:', activeExtractors.map(e => ({ id: e.id, name: e.name, enabled: e.enabled })));

  if (activeExtractors.length === 0) {
    $("#extractInfo").textContent = 'No active extractors found';
    return;
  }

  const scope = $("#extractScope").value === 'filtered' ? 'filtered' : 'all';

  $("#extractInfo").textContent = 'Running extractors…';
  $("#extractorProgress").style.display = 'block';
  sendToWorker('RUN_EXTRACTORS', { extractors: activeExtractors, scope });
}

function renderQueryFields() {
  const el = $("#queryFields");
  if (!el) return;
  const fields = [...fieldNames].sort().slice(0, 20);
  if (fields.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = fields.map(f => `<button class="btn ghost" data-field="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join(' ');
  el.querySelectorAll('button[data-field]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const f = e.currentTarget.dataset.field;
      const tq = $("#textQuery");
      if (!tq) return;
      const insert = `${f}:`;
      const pos = tq.selectionStart || tq.value.length;
      tq.value = tq.value.slice(0, pos) + insert + tq.value.slice(pos);
      tq.focus();
    });
  });
}

/**
 * Legacy: Run extractor from manual input (for backwards compatibility)
 */
function runExtractor() {
  const pattern = $("#extractPattern").value.trim();
  if (!pattern) {
    alert('Provide a named‑group regex.');
    return;
  }

  const scope = $("#extractScope").value === 'filtered' ? view : rows;
  const hits = runSingleExtractor(pattern, scope);

  $("#extractInfo").textContent = `Applied to ${fmt(scope.length)} rows · ${fmt(hits)} with captures`;
  updateSortOptions();
  applyFilters();
}

// ---------- File Handling ----------

/**
 * Read file as text using FileReader API
 * @param {File} file - File object
 * @returns {Promise<string>} - File content as text
 */
async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result);
    r.readAsText(file);
  });
}

/**
 * Detect file format based on extension
 * @param {string} filename - Name of the file
 * @returns {string} - Format type: 'csv', 'json', or 'log'
 */
function detectFileFormat(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  
  // Default to log format for .log, .txt, and unknown extensions
  return 'log';
}

/**
 * Handle uploaded file and parse it based on format
 * @param {File} file - File object to process
 */
async function handleFile(file) {
  $("#fileTag").textContent = file.name;
  $("#info").textContent = 'Parsing…';
  $("#uploadProgress").style.display = 'block';

  try {
    const text = await readFileAsText(file);
    const format = detectFileFormat(file.name);

    // Clear existing field names for new file
    fieldNames.clear();

    // Send to worker for processing
    sendToWorker('PARSE_DATA', { text, format });
  } catch (error) {
    console.error('File reading error:', error);
    $("#info").textContent = 'Error reading file';
    $("#uploadProgress").style.display = 'none';
    alert('Error reading file: ' + error.message);
  }
}

// ---------- Export Functions ----------

/**
 * Export current view as JSON file
 */
/**
 * Export current view as JSON file
 */
async function exportJSON() {
  try {
    const response = await sendToWorker('GET_FULL_VIEW', {}, true);
    const view = response.data;
    const blob = new Blob([JSON.stringify(view, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'logsieve-data.json';
    a.click();
  } catch (error) {
    console.error('Export JSON failed:', error);
    alert('Failed to export JSON: ' + error.message);
  }
}

/**
 * Export current view as CSV file
 */
async function exportCSV() {
  try {
    const response = await sendToWorker('GET_FULL_VIEW', {}, true);
    const view = response.data;
    const sortedFields = [...fieldNames].sort();
    const header = ['id', 'ts', 'level', 'message', ...sortedFields];
    const lines = [header.join(',')];

    for (const r of view) {
      const baseFields = [
        r.id,
        r.ts || '',
        r.level || '',
        (r.message || '').replaceAll('"', '""')
      ];
      
      // Add extracted fields - format arrays as JSON strings
      const extractedFields = sortedFields.map(fieldName => {
        const val = r.fields?.[fieldName];
        if (!val) return '';
        if (Array.isArray(val)) {
          if (val.length === 1) return val[0];
          return JSON.stringify(val);
        }
        return String(val);
      });
      
      // Build CSV row with proper quoting
      const csvRow = [
        baseFields[0], // id
        baseFields[1], // ts
        baseFields[2], // level
        `"${baseFields[3]}"`, // message (quoted)
        ...extractedFields.map(f => `"${String(f).replaceAll('"', '""')}"`)
      ].join(',');
      
      lines.push(csvRow);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'logsieve-data.csv';
    a.click();
  } catch (error) {
    console.error('Export CSV failed:', error);
    alert('Failed to export CSV: ' + error.message);
  }
}

/**
 * Export extractors and filters library
 */
function exportLibrary() {
  const data = Storage.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `logsieve-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

/**
 * Import extractors and filters library
 * @param {File} file - JSON file to import
 */
async function importLibrary(file) {
  try {
    const text = await readFileAsText(file);
    const data = JSON.parse(text);

    // Validate data structure
    if (!data.extractors && !data.filters) {
      alert('Invalid library file: no extractors or filters found.');
      return;
    }

    // Ask user about merge vs replace
    const merge = confirm(
      'Import mode:\n\n' +
      'OK = Merge with existing (keep current items)\n' +
      'Cancel = Replace existing (delete current items)\n\n' +
      `Importing: ${data.extractors?.length || 0} extractors, ${data.filters?.length || 0} filters`
    );

    const results = Storage.importAll(data, merge);

    if (results.errors.length > 0) {
      alert('Import completed with errors:\n' + results.errors.join('\n'));
    } else {
      alert(`Import successful!\n\nImported:\n- ${results.extractors} extractors\n- ${results.filters} filters`);
    }

    // Refresh UI
    renderExtractorList();
    renderFilterList();
    updateExtractorInfo();
    updateFilterLibInfo();
  } catch (e) {
    alert('Failed to import library: ' + e.message);
  }
}

// ---------- UI Management ----------

/**
 * Render the extractor library list
 */
function renderExtractorList() {
  const extractors = Storage.getExtractors();
  const activeIds = Storage.getActiveExtractors();
  const container = $("#extractorList");

  if (extractors.length === 0) {
    container.innerHTML = '<div class="empty-state">No extractors saved. Click "+ New Extractor" to create one.</div>';
    return;
  }

  container.innerHTML = extractors.map(ext => `
    <div class="library-item" data-id="${ext.id}">
      <input type="checkbox" class="extractor-checkbox" data-id="${ext.id}" ${activeIds.includes(ext.id) ? 'checked' : ''} />
      <div class="library-item-content">
        <div class="library-item-title">${escapeHtml(ext.name)}</div>
        ${ext.description ? `<div class="library-item-desc">${escapeHtml(ext.description)}</div>` : ''}
        <div class="library-item-pattern">${escapeHtml(ext.pattern)}</div>
      </div>
      <div class="library-item-actions">
        <button class="btn ghost edit-extractor" data-id="${ext.id}">Edit</button>
        <button class="btn ghost delete-extractor" data-id="${ext.id}">Delete</button>
      </div>
    </div>
  `).join('');

  // Attach event listeners
  container.querySelectorAll('.extractor-checkbox').forEach(cb => {
    cb.addEventListener('change', handleExtractorToggle);
  });
  container.querySelectorAll('.edit-extractor').forEach(btn => {
    btn.addEventListener('click', handleEditExtractor);
  });
  container.querySelectorAll('.delete-extractor').forEach(btn => {
    btn.addEventListener('click', handleDeleteExtractor);
  });
}

/**
 * Render the filter library list
 */
function renderFilterList() {
  const filters = Storage.getFilters();
  const container = $("#filterList");

  if (filters.length === 0) {
    container.innerHTML = '<div class="empty-state">No filters saved. Apply filters and click "Save Current Filter".</div>';
    return;
  }

  container.innerHTML = filters.map(filter => {
    const settings = [];
    // Show builder rules count and advanced query if present
    if (filter.version === 2) {
      if (filter.rules && filter.rules.length) settings.push(`rules: ${filter.rules.length}`);
      if (filter.advancedQuery) settings.push(`advanced: ${escapeHtml(filter.advancedQuery)}`);
      if (filter.quickSearch) settings.push(`quick: ${filter.quickSearch}`);
    } else {
      if (filter.query) settings.push(`legacy: ${filter.query}`);
    }

    return `
      <div class="library-item" data-id="${filter.id}">
        <div class="library-item-content">
          <div class="library-item-title">${escapeHtml(filter.name)}</div>
          ${filter.description ? `<div class="library-item-desc">${escapeHtml(filter.description)}</div>` : ''}
          <div class="filter-item-settings">
            ${settings.map(s => `<span>${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>
        <div class="library-item-actions">
          <button class="btn apply-filter" data-id="${filter.id}">Apply</button>
          <button class="btn ghost delete-filter" data-id="${filter.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners
  container.querySelectorAll('.apply-filter').forEach(btn => {
    btn.addEventListener('click', handleApplyFilter);
  });
  container.querySelectorAll('.delete-filter').forEach(btn => {
    btn.addEventListener('click', handleDeleteFilter);
  });

  // Keep the saved filter dropdown updated with latest list
  populateSavedFilterDropdown();
}

/**
 * Populate the Saved Filters <select> dropdown in Filters & Sort
 */
function populateSavedFilterDropdown() {
  const select = $('#savedFilterSelect');
  if (!select) return;
  const filters = Storage.getFilters();
  const options = ['<option value="">-- Select saved filter --</option>'];
  filters.forEach(f => options.push(`<option value="${f.id}">${escapeHtml(f.name)}</option>`));
  select.innerHTML = options.join('');
}

/**
 * Load a saved filter into the Filters & Sort UI without applying it
 * @param {Object} filter
 */
function loadFilterIntoUI(filter) {
  if (!filter) return;

  // Populate Advanced Query and sort fields
  $("#textQuery").value = filter.advancedQuery || filter.quickSearch || filter.query || '';
  $("#sort").value = filter.sort || 'id';
  $("#order").value = filter.order || 'desc';

  // If v2 format, set builder rules and render
  if (filter.version === 2) {
    currentFilterConfig = { version: 2, rules: JSON.parse(JSON.stringify(filter.rules || [])), quickSearch: filter.quickSearch || '' };
    renderBuilderUI();
    // ensure builder is visible so rules appear to the user
    const b = $("#filterBuilder");
    if (b) { b.style.display = 'block'; builderOpen = true; }
  } else {
    currentFilterConfig = null;
    renderBuilderUI();
  }
  updateFilterTag();
}

/**
 * Open extractor modal for creating/editing
 * @param {string} extractorId - Optional ID for editing existing extractor
 */
function openExtractorModal(extractorId = null) {
  const modal = $("#extractorModal");
  const title = $("#extractorModalTitle");
  
  if (extractorId) {
    const extractor = Storage.getExtractors().find(e => e.id === extractorId);
    if (!extractor) return;

    title.textContent = "Edit Extractor";
    $("#extractorName").value = extractor.name;
    $("#extractorPattern").value = extractor.pattern;
    $("#extractorDesc").value = extractor.description || '';
    $("#extractorEnabled").checked = extractor.enabled !== false;
    modal.dataset.editId = extractorId;
  } else {
    title.textContent = "New Extractor";
    $("#extractorName").value = '';
    $("#extractorPattern").value = '';
    $("#extractorDesc").value = '';
    $("#extractorEnabled").checked = true;
    delete modal.dataset.editId;
  }

  modal.classList.add('active');
}

/**
 * Close extractor modal
 */
function closeExtractorModal() {
  $("#extractorModal").classList.remove('active');
}

/**
 * Save extractor from modal
 */
function saveExtractorFromModal() {
  const modal = $("#extractorModal");
  const name = $("#extractorName").value.trim();
  const pattern = $("#extractorPattern").value.trim();
  const description = $("#extractorDesc").value.trim();
  const enabled = $("#extractorEnabled").checked;

  if (!name) {
    alert('Please provide a name for the extractor.');
    return;
  }

  if (!pattern) {
    alert('Please provide a regex pattern.');
    return;
  }

  // Validate regex
  try {
    new RegExp(pattern);
  } catch (e) {
    alert('Invalid regex pattern: ' + e.message);
    return;
  }

  const extractor = {
    name,
    pattern,
    description,
    enabled
  };

  if (modal.dataset.editId) {
    extractor.id = modal.dataset.editId;
  }

  Storage.saveExtractor(extractor);
  renderExtractorList();
  closeExtractorModal();
}

/**
 * Open filter modal for saving current filter
 */
function openFilterModal() {
  const modal = $("#filterModal");
  
  $("#filterName").value = '';
  $("#filterDesc").value = '';

  // Show current filter settings (builder + advanced)
  const preview = $("#filterPreview");
  const settings = [];
  if (currentFilterConfig && currentFilterConfig.rules && currentFilterConfig.rules.length) settings.push(`rules: ${currentFilterConfig.rules.length}`);
  const adv = $("#textQuery").value.trim();
  if (adv) settings.push(`advanced: ${escapeHtml(adv)}`);
  settings.push(`Sort: ${$("#sort").value} (${$("#order").value})`);
  preview.innerHTML = settings.join('<br>');

  modal.classList.add('active');
}

/**
 * Close filter modal
 */
function closeFilterModal() {
  $("#filterModal").classList.remove('active');
}

/**
 * Save filter from modal
 */
function saveFilterFromModal() {
  const name = $("#filterName").value.trim();
  const description = $("#filterDesc").value.trim();

  if (!name) {
    alert('Please provide a name for the filter.');
    return;
  }

  const filter = {
    name,
    description,
    version: 2,
    rules: currentFilterConfig?.rules ? JSON.parse(JSON.stringify(currentFilterConfig.rules)) : [],
    advancedQuery: $("#textQuery").value.trim(),
    sort: $("#sort").value,
    order: $("#order").value
  };

  Storage.saveFilter(filter);
  renderFilterList();
  closeFilterModal();
  updateFilterLibInfo();
}

/**
 * Handle extractor toggle (checkbox)
 */
function handleExtractorToggle(e) {
  const id = e.target.dataset.id;
  const activeIds = Storage.getActiveExtractors();

  if (e.target.checked) {
    if (!activeIds.includes(id)) {
      activeIds.push(id);
    }
  } else {
    const idx = activeIds.indexOf(id);
    if (idx >= 0) {
      activeIds.splice(idx, 1);
    }
  }

  Storage.setActiveExtractors(activeIds);
  updateExtractorInfo();
}

/**
 * Handle edit extractor button
 */
function handleEditExtractor(e) {
  const id = e.target.dataset.id;
  openExtractorModal(id);
}

/**
 * Handle delete extractor button
 */
function handleDeleteExtractor(e) {
  const id = e.target.dataset.id;
  const extractor = Storage.getExtractors().find(e => e.id === id);
  
  if (extractor && confirm(`Delete extractor "${extractor.name}"?`)) {
    Storage.deleteExtractor(id);
    renderExtractorList();
    updateExtractorInfo();
  }
}

/**
 * Handle apply filter button
 */
function handleApplyFilter(e) {
  const id = e.target.dataset.id;
  const filter = Storage.getFilters().find(f => f.id === id);
  
  if (!filter) return;

  // Show progress
  $("#savedFilterProgress").style.display = 'block';
  $("#savedFilterProgressFill").style.width = '0%';
  $("#savedFilterProgressText").textContent = 'Applying saved filter...';

  // Apply saved filter settings to UI
  $("#textQuery").value = filter.advancedQuery || filter.quickSearch || filter.query || '';
  $("#sort").value = filter.sort || 'id';
  $("#order").value = filter.order || 'desc';
  $("#sort").value = filter.sort || 'id';
  $("#order").value = filter.order || 'desc';

  // If this is a v2 filter, set as current structured filter
  if (filter.version === 2) {
    // Set the structured builder rules
    currentFilterConfig = { version: 2, rules: JSON.parse(JSON.stringify(filter.rules || [])), quickSearch: filter.quickSearch || '' };
    appliedFilterConfig = JSON.parse(JSON.stringify(currentFilterConfig));
    // Open the builder UI when applying a saved v2 filter so builder rules are visible
  const b = $("#filterBuilder");
    if (b) {
      b.style.display = 'block';
      builderOpen = true;
    }
    renderBuilderUI();
  } else {
    currentFilterConfig = null;
  }

  // Trigger filter application
  // Also set applied advanced query from saved filter
  if (filter.advancedQuery) {
    try {
      const parser = new QueryParser(filter.advancedQuery);
      const rules = parser.parse();
      appliedAdvancedQuery = QueryParser.compileToFilter(rules);
    } catch (err) {
      appliedAdvancedQuery = null;
    }
  } else {
    appliedAdvancedQuery = null;
  }
  applyFilters('saved-filtering');
}

/**
 * --- Query Builder: functions ---
 */
function createEmptyRule() {
  return { id: generateUUID(), field: 'level', operator: 'equals', value: '', logic: 'AND', enabled: true };
}

function addRule(rule = null) {
  currentFilterConfig = currentFilterConfig || { version: 2, rules: [], quickSearch: '' };
  const r = rule || createEmptyRule();
  // If there are existing rules, default logic from previous one remains; ensure last rule logic is null
  if (currentFilterConfig.rules.length > 0) {
    currentFilterConfig.rules[currentFilterConfig.rules.length - 1].logic = 'AND';
  }
  currentFilterConfig.rules.push(r);
  currentFilterConfig.rules[currentFilterConfig.rules.length - 1].logic = null;
  // do not apply; wait for user to press Apply
}

function deleteRule(id) {
  currentFilterConfig = currentFilterConfig || { version: 2, rules: [], quickSearch: '' };
  currentFilterConfig.rules = currentFilterConfig.rules.filter(r => r.id !== id);
  // Ensure logic on last rule is null
  if (currentFilterConfig.rules.length > 0) currentFilterConfig.rules[currentFilterConfig.rules.length - 1].logic = null;
  renderBuilderUI();
  // do not auto-apply
}

function updateRuleField(id, fieldName) {
  const r = (currentFilterConfig?.rules || []).find(rr => rr.id === id);
  if (!r) return;
  r.field = fieldName;
  // pick default operator for the field
  const sample = FieldRegistry.get(fieldName)?.samples?.[0];
  const ops = getOperatorsForField(fieldName, sample);
  r.operator = ops?.[0]?.value || 'equals';
  r.value = '';
  renderBuilderUI();
  // do not auto-apply
}

function updateRuleOperator(id, operator) {
  const r = (currentFilterConfig?.rules || []).find(rr => rr.id === id);
  if (!r) return;
  r.operator = operator;
  renderBuilderUI();
  // do not auto-apply
}

function updateRuleValue(id, value) {
  const r = (currentFilterConfig?.rules || []).find(rr => rr.id === id);
  if (!r) return;
  r.value = value;
  // do not auto-apply; preview updated by renderBuilderUI
}

function updateRuleLogic(id, logic) {
  const idx = (currentFilterConfig?.rules || []).findIndex(rr => rr.id === id);
  if (idx < 0) return;
  currentFilterConfig.rules[idx].logic = logic;
  renderBuilderUI();
  // do not auto-apply
}

function rulesToQuery(rules) {
  if (!rules || rules.length === 0) return '';
  const parts = rules.map(rule => {
    let prefix = '';
    if (['greaterThan','greaterOrEqual','lessThan','lessOrEqual','notEquals'].includes(rule.operator)) {
      const opMap = { 'greaterThan': '>', 'greaterOrEqual': '>=', 'lessThan': '<', 'lessOrEqual': '<=', 'notEquals': '!=' };
      prefix = opMap[rule.operator];
    } else if (rule.operator === 'startsWith') {
      prefix = '^';
    } else if (rule.operator === 'endsWith') {
      // We'll append suffix on value
      // keep prefix empty
    }
    let val = String(rule.value || '');
    if (rule.operator === 'endsWith') val = val + '$';
    // Quote if contains spaces
    if (val.includes(' ')) val = '"' + val + '"';
    return `${rule.field}:${prefix}${val}${rule.logic ? ' ' + rule.logic + ' ' : ''}`;
  }).join('');
  return parts;
}

/**
 * Query Parser - tokenizes and parses text queries into v2 filter rules
 * Supports simple field:value tokens, comparison operators, quoted strings,
 * AND/OR logic, and minimal prefix operators (^ for startsWith, $ for endsWith)
 */
class QueryParser {
  constructor(queryString) {
    this.query = queryString || '';
    this.pos = 0;
    this.tokens = [];
  }

  tokenize() {
    const patterns = [
      { type: 'FIELD_OP', regex: /(\w+):(>=|<=|!=|>|<|=)("[^"]*"|[^\s)]+)/y },
      { type: 'FIELD', regex: /(\w+):("[^"]*"|[^\s)]+)/y },
      { type: 'STRING', regex: /"([^"]*)"/y },
      { type: 'AND', regex: /\bAND\b/iy },
      { type: 'OR', regex: /\bOR\b/iy },
      { type: 'NOT', regex: /\bNOT\b/iy },
      { type: 'LPAREN', regex: /\(/y },
      { type: 'RPAREN', regex: /\)/y },
      { type: 'WORD', regex: /[^\s()]+/y }
    ];

    const s = this.query;
    let i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      let matched = false;
      for (const p of patterns) {
        p.regex.lastIndex = i;
        const m = p.regex.exec(s);
        if (m) {
          matched = true;
          const token = { type: p.type, raw: m[0] };
          if (p.type === 'FIELD_OP') {
            token.field = m[1];
            token.operator = this._mapOperator(m[2]);
            token.value = m[3].replace(/^"|"$/g, '');
          } else if (p.type === 'FIELD') {
            token.field = m[1];
            token.operator = 'contains';
            token.value = m[2].replace(/^"|"$/g, '');
            if (token.value.startsWith('^')) { token.operator = 'startsWith'; token.value = token.value.slice(1); }
            if (token.value.endsWith('$')) { token.operator = 'endsWith'; token.value = token.value.slice(0, -1); }
          } else if (p.type === 'WORD') {
            token.value = m[0];
          } else if (p.type === 'STRING') {
            token.value = m[1];
          }

          this.tokens.push(token);
          i = p.regex.lastIndex;
          break;
        }
      }
      if (!matched) {
        // Unknown character, skip
        i++;
      }
    }

    return this.tokens;
  }

  _mapOperator(op) {
    const map = { '=': 'equals', '!=': 'notEquals', '>': 'greaterThan', '>=': 'greaterOrEqual', '<': 'lessThan', '<=': 'lessOrEqual' };
    return map[op] || 'equals';
  }

  parse() {
    this.tokenize();
    const rules = [];
    let currentLogic = null;

    for (const token of this.tokens) {
      if (token.type === 'FIELD' || token.type === 'FIELD_OP') {
        rules.push({ id: generateUUID(), field: token.field, operator: token.operator, value: token.value, logic: currentLogic, enabled: true });
        currentLogic = null;
      } else if (token.type === 'AND') {
        currentLogic = 'AND';
      } else if (token.type === 'OR') {
        currentLogic = 'OR';
      } else if (token.type === 'WORD') {
        // Treat plain word as quickSearch token - we'll handle externally
      }
    }

    if (rules.length > 0) rules[rules.length - 1].logic = null;
    return rules;
  }

  static compileToFilter(rules) {
    return { version: 2, rules: rules, quickSearch: '' };
  }
}

function renderBuilderUI() {
  const cont = $("#rulesContainer");
  if (!cont) return;

  if (!currentFilterConfig) currentFilterConfig = { version: 2, rules: [], quickSearch: '' };

  if (!Array.isArray(currentFilterConfig.rules) || currentFilterConfig.rules.length === 0) {
    cont.innerHTML = '<div class="empty-state">No filter rules. Click + Add Filter Rule to get started.</div>';
    $("#builderPreview").textContent = '';
    return;
  }

  // Build HTML for rules
  const allFields = [...fieldNames].sort();
  const html = currentFilterConfig.rules.map((rule, idx) => {
    const ops = getOperatorsForField(rule.field, FieldRegistry.get(rule.field)?.samples?.[0] || '');
    return `
      <div class="filter-rule" data-rule-id="${rule.id}">
        <select class="field-select" data-rule-id="${rule.id}">` +
        ` <optgroup label="Standard Fields">` +
        ` <option value="level" ${rule.field === 'level'? 'selected':''}>Level</option>` +
        ` <option value="ts" ${rule.field === 'ts'? 'selected':''}>Timestamp</option>` +
        ` <option value="message" ${rule.field === 'message'? 'selected':''}>Message</option>` +
        ` <option value="raw" ${rule.field === 'raw'? 'selected':''}>Raw</option>` +
        ` </optgroup>` +
        (allFields.length ? ` <optgroup label="Extracted Fields">` + allFields.map(f => ` <option value="${escapeHtml(f)}" ${rule.field === f? 'selected':''}>${escapeHtml(f)}</option>`).join('') + ` </optgroup>` : '') +
        `</select>
        <select class="operator-select" data-rule-id="${rule.id}">` +
          ops.map(op => `<option value="${op.value}" ${rule.operator === op.value ? 'selected' : ''}>${escapeHtml(op.label)}</option>`).join('') +
        `</select>
        ${ (() => {
            const meta = FieldRegistry.get(rule.field);
            const isDate = meta?.type === 'date' || rule.field === 'ts';
            if (rule.operator === 'between' && isDate) {
              const parts = (rule.value || '').split(',');
              const start = parts[0] ? new Date(parts[0]).toISOString().slice(0,16) : '';
              const end = parts[1] ? new Date(parts[1]).toISOString().slice(0,16) : '';
              return `
                <input type="datetime-local" class="value-input" data-rule-id="${rule.id}" data-sub="start" value="${escapeHtml(start)}" />
                <span style="padding:0 8px; color:var(--muted);">to</span>
                <input type="datetime-local" class="value-input" data-rule-id="${rule.id}" data-sub="end" value="${escapeHtml(end)}" />
              `;
            }
            if (isDate) {
              return `<input type="datetime-local" class="value-input" data-rule-id="${rule.id}" value="${escapeHtml(rule.value ? (new Date(rule.value).toISOString().slice(0,16)) : '')}" placeholder="Enter date/time" />`;
            }
            return `<input class="value-input" data-rule-id="${rule.id}" value="${escapeHtml(rule.value || '')}" placeholder="Enter value..." list="values-${rule.id}" />`;
          })()
        }
        <datalist id="values-${rule.id}">
          ${FieldRegistry.getUniqueValues(rule.field, 50).map(val => `<option value="${escapeHtml(val)}">`).join('')}
        </datalist>
        <button class="delete-rule" data-rule-id="${rule.id}">×</button>
      </div>
      ${ (idx !== currentFilterConfig.rules.length - 1) ? `
        <div class="logic-selector">
          <label><input type="radio" name="logic-${rule.id}" value="AND" ${rule.logic === 'AND' ? 'checked' : ''} data-rule-id="${rule.id}" class="logic-input"> AND</label>
          <label><input type="radio" name="logic-${rule.id}" value="OR" ${rule.logic === 'OR' ? 'checked' : ''} data-rule-id="${rule.id}" class="logic-input"> OR</label>
        </div>
      ` : '' }
    `;
  }).join('');

  cont.innerHTML = html;

  // Attach listeners
  cont.querySelectorAll('.field-select').forEach(sel => {
    sel.addEventListener('change', (e) => updateRuleField(e.target.dataset.ruleId, e.target.value));
  });
  cont.querySelectorAll('.operator-select').forEach(sel => {
    sel.addEventListener('change', (e) => updateRuleOperator(e.target.dataset.ruleId, e.target.value));
  });
  cont.querySelectorAll('.value-input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const id = e.target.dataset.ruleId;
      const sub = e.target.dataset.sub; // for between start/end
      const val = e.target.value;

      if (sub) {
        // pair input - find both values and combine as CSV of ISO strings
        const startEl = cont.querySelector(`.value-input[data-rule-id="${id}"][data-sub="start"]`);
        const endEl = cont.querySelector(`.value-input[data-rule-id="${id}"][data-sub="end"]`);
        const startVal = startEl?.value ? new Date(startEl.value).toISOString() : '';
        const endVal = endEl?.value ? new Date(endEl.value).toISOString() : '';
        const combined = [startVal, endVal].filter(Boolean).join(',');
        updateRuleValue(id, combined);
        return;
      }

      if (e.target.type === 'datetime-local') {
        if (!val) updateRuleValue(id, '');
        else updateRuleValue(id, new Date(val).toISOString());
      } else {
        updateRuleValue(id, val);
      }
    });
  });
  cont.querySelectorAll('.delete-rule').forEach(btn => {
    btn.addEventListener('click', (e) => { deleteRule(e.target.dataset.ruleId); });
  });
  cont.querySelectorAll('.logic-input').forEach(inp => {
    inp.addEventListener('change', (e) => updateRuleLogic(e.target.dataset.ruleId, e.target.value));
  });

  // Update preview (show generated query only; remove 'Generated:' prefix per request)
  const preview = rulesToQuery(currentFilterConfig.rules);
  $("#builderPreview").textContent = preview ? preview : '';

  // Keep advanced query separate — do not update textQuery from builder
}

/**
 * Handle delete filter button
 */
function handleDeleteFilter(e) {
  const id = e.target.dataset.id;
  const filter = Storage.getFilters().find(f => f.id === id);
  
  if (filter && confirm(`Delete filter "${filter.name}"?`)) {
    Storage.deleteFilter(id);
    renderFilterList();
    updateFilterLibInfo();
  }
}

/**
 * Update extractor info display
 */
function updateExtractorInfo() {
  const activeIds = Storage.getActiveExtractors();
  const totalExtractors = Storage.getExtractors().length;
  $("#extractInfo").textContent = `${activeIds.length} of ${totalExtractors} active`;
}

/**
 * Update filter library info
 */
function updateFilterLibInfo() {
  const totalFilters = Storage.getFilters().length;
  $("#filterLibInfo").textContent = `${totalFilters} saved`;
  populateSavedFilterDropdown();
}

/**
 * Initialize collapsible sections (legacy - kept for backwards compatibility)
 */
function initializeCollapsibles() {
  document.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      const content = header.nextElementSibling;
      if (content && content.classList.contains('collapsible-content')) {
        content.classList.toggle('collapsed');
      }
    });
  });
}

// ---------- Sidebar & Accordion Navigation ----------

/**
 * Navigate to a specific section
 * @param {string} sectionId - ID of section to navigate to
 */
function navigateToSection(sectionId, tab) {
  // Get all sections except always-visible ones
  const sections = document.querySelectorAll('.section-card:not(.always-visible)');
  const targetSection = document.getElementById(`section-${sectionId}`);
  
  if (!targetSection) return;
  
  // Collapse all sections except the target
  sections.forEach(section => {
    if (section.id === `section-${sectionId}`) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });
  
  // Update nav links
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    if (link.dataset.section === sectionId) {
      // If caller provided a specific tab, only highlight the nav link that matches both
      if (tab) {
        link.classList.toggle('active', link.dataset.tab === tab);
      } else {
        link.classList.add('active');
      }
    } else {
      link.classList.remove('active');
    }
  });
  
  // Scroll to section
  targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  // Close mobile sidebar if open
  closeMobileSidebar();
}

/**
 * Toggle accordion section
 * @param {HTMLElement} header - Section header element
 */
function toggleSection(header) {
  const section = header.closest('.section-card');
  
  // Don't toggle always-visible sections
  if (section.classList.contains('always-visible')) {
    return;
  }
  
  const sectionId = section.dataset.section;
  
  if (section.classList.contains('active')) {
    // Collapse current section
    section.classList.remove('active');
  } else {
    // Navigate to this section (will collapse others)
    // If user is opening the Search Tools collapsible, default to Filters tab
    if (sectionId === 'search') {
      navigateToSection(sectionId, 'filters');
    } else {
      navigateToSection(sectionId);
    }
  }
}

/**
 * Initialize sidebar navigation
 */
function initializeSidebar() {
  // Handle nav link clicks
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.dataset.section;
      const tab = link.dataset.tab;
  navigateToSection(sectionId, tab);
      // If this is a Search Tools nav that asks for a specific tab, open it
      if (sectionId === 'search' && tab) {
        showSearchTab(tab);
      }
    });
  });
  
  // Handle section header clicks
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      toggleSection(header);
    });
  });
  
  // Hamburger menu toggle
  const hamburger = $('#hamburgerMenu');
  if (hamburger) {
    hamburger.addEventListener('click', toggleMobileSidebar);
  }

  // Sidebar close button (mobile)
  const closeSidebarBtn = $('#closeSidebar');
  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', (e) => {
      // If mobile, use existing mobile close behavior
      if (window.matchMedia('(max-width: 900px)').matches) {
        closeMobileSidebar();
      } else {
        // Desktop: collapse sidebar by toggling a class on body
        document.body.classList.toggle('sidebar-collapsed');
      }
    });
  }
  
  // Close sidebar when clicking overlay
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('sidebar-open')) {
      const sidebar = $('#sidebar');
      const hamburger = $('#hamburgerMenu');
      if (!sidebar.contains(e.target) && !hamburger.contains(e.target)) {
        closeMobileSidebar();
      }
    }
  });
  
  // Set initial state - default to upload section if no section is already active
  const hasActiveSection = document.querySelector('.section-card.active');
  if (!hasActiveSection) {
    const uploadSection = document.getElementById('section-upload');
    if (uploadSection) {
      uploadSection.classList.add('active');
      // Update nav link to match
      const uploadNavLink = document.querySelector('.nav-link[data-section="upload"]');
      if (uploadNavLink) {
        uploadNavLink.classList.add('active');
      }
    }
  }
}

/**
 * Show a specific tab inside the Search Tools collapsible
 * @param {string} tab - 'help' | 'filters' | 'extractors'
 */
function showSearchTab(tab) {
  const t = tab || 'help';
  const allBtns = document.querySelectorAll('.tab-btn');
  allBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === t));

  const panels = document.querySelectorAll('.tab-panel');
  panels.forEach(p => p.style.display = (p.id === 'tab-' + t) ? '' : 'none');
}

/**
 * Toggle mobile sidebar visibility
 */
function toggleMobileSidebar() {
  const sidebar = $('#sidebar');
  const body = document.body;
  // If the sidebar was collapsed on desktop, un-collapse it (re-open)
  if (body.classList.contains('sidebar-collapsed')) {
    body.classList.remove('sidebar-collapsed');
    return;
  }

  // Default mobile toggle behavior: slide in/out
  sidebar.classList.toggle('open');
  body.classList.toggle('sidebar-open');
}

/**
 * Close mobile sidebar
 */
function closeMobileSidebar() {
  const sidebar = $('#sidebar');
  const body = document.body;
  
  sidebar.classList.remove('open');
  body.classList.remove('sidebar-open');
}

// ---------- Event Handlers ----------

/**
 * Initialize all event listeners when DOM is ready
 */
function initializeEventHandlers() {
  // Filter controls
  ["sort", "order"].forEach(id =>
    $("#" + id).addEventListener('change', applyFilters)
  );

  // Page size dropdown - update per variable and apply filters
  $("#per").addEventListener('change', () => {
    per = +$("#per").value;
    page = 1; // Reset to first page when changing page size
    applyFilters();
  });

  // Also ensure changing filter inputs will cancel any active v2 structured filter (unless builder is open)
  ["sort", "order"].forEach(id => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener('input', () => { if (!builderOpen) currentFilterConfig = null; });
  });

  // Action buttons
  $("#apply").addEventListener('click', async e => {
    e.preventDefault();
    // Apply: copy current builder rules to appliedFilterConfig
    appliedFilterConfig = currentFilterConfig ? JSON.parse(JSON.stringify(currentFilterConfig)) : null;
    
    // Show progress
    $("#filterProgress").style.display = 'block';
    $("#filterProgressFill").style.width = '0%';
    $("#filterProgressText").textContent = 'Applying filters...';
    
    // Parse advanced query using worker
    const queryText = $("#textQuery").value.trim();
    if (queryText) {
      try {
        const response = await sendToWorker('PARSE_ADVANCED_QUERY', { queryText }, true);
        if (response.data.success) {
          appliedAdvancedQuery = response.data.result;
          $('#queryError').textContent = '';
        } else {
          appliedAdvancedQuery = null;
          $('#queryError').textContent = 'Query parse error: ' + response.data.error;
          $("#filterProgress").style.display = 'none';
          return; // Don't apply filters if query parsing failed
        }
      } catch (error) {
        appliedAdvancedQuery = null;
        $('#queryError').textContent = 'Query parse error: ' + error.message;
        $("#filterProgress").style.display = 'none';
        return;
      }
    } else {
      appliedAdvancedQuery = null;
    }
    
    applyFilters();
  });

  // Builder always visible (no toggle)

  // Builder buttons
  $("#addFilterRule").addEventListener('click', () => {
    addRule();
    renderBuilderUI();
    // Do not auto-apply builder changes; require Apply
  });

  $("#clearFilterRules").addEventListener('click', () => {
    currentFilterConfig = currentFilterConfig || { version: 2, rules: [], quickSearch: '' };
    currentFilterConfig.rules = [];
    renderBuilderUI();
    // Clearing builder does not auto-apply unless user presses Apply
  });

  // Builder is always visible and primary
  const b = $("#filterBuilder");
  if (b) {
    b.style.display = 'block';
    builderOpen = true;
    renderBuilderUI();
  }

  // Text Query input parsing (two-way sync)
  const textQueryInput = $("#textQuery");
  if (textQueryInput) {
    let parseTimer = null;
    textQueryInput.addEventListener('input', (e) => {
        // Clear previous validation timeout
        clearTimeout(parseTimer);
        // For now, just clear any previous error - full validation happens on Apply
        parseTimer = setTimeout(() => {
          $('#queryError').textContent = '';
        }, 200);
      });
    
    // Clickable field name suggestions
    renderQueryFields();
  }

  $("#clear").addEventListener('click', e => {
    e.preventDefault();
    // Clear advanced query and builder; remove applied filter state as well
    $("#textQuery").value = '';
    currentFilterConfig = null;
    appliedFilterConfig = null;
    appliedAdvancedQuery = null;
    applyFilters();
  });

  // Pagination
  $("#first").addEventListener('click', () => {
    if (page > 1) {
      page = 1;
      render();
    }
  });

  $("#prev").addEventListener('click', () => {
    if (page > 1) {
      page--;
      render();
    }
  });

  $("#next").addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(totalRows / per));
    if (page < max) {
      page++;
      render();
    }
  });

  $("#last").addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(totalRows / per));
    if (page < max) {
      page = max;
      render();
    }
  });

  // Extractor
  $("#runExtract").addEventListener('click', runExtractor);

  // Export/Import
  $("#exportJSON").addEventListener('click', exportJSON);
  $("#exportCSV").addEventListener('click', exportCSV);
  $("#exportLibrary").addEventListener('click', exportLibrary);
  $("#importLibrary").addEventListener('click', () => $("#importFile").click());
  $("#importFile").addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) importLibrary(f);
    e.target.value = ''; // Reset input
  });

  // File handling
  const drop = $("#drop");
  const fileInput = $("#file");
  const pick = $("#pick");

  // Drag & drop events
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('drag');
    })
  );

  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('drag');
    })
  );

  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  });

  pick.addEventListener('click', e => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  });

  // Extractor library
  $("#addExtractor").addEventListener('click', () => openExtractorModal());
  $("#runActiveExtractors").addEventListener('click', runActiveExtractors);
  $("#closeExtractorModal").addEventListener('click', closeExtractorModal);
  $("#cancelExtractor").addEventListener('click', closeExtractorModal);
  $("#saveExtractor").addEventListener('click', saveExtractorFromModal);

  // Filter library
  $("#saveCurrentFilter").addEventListener('click', openFilterModal);
  $("#closeFilterModal").addEventListener('click', closeFilterModal);
  $("#cancelFilter").addEventListener('click', closeFilterModal);
  $("#saveFilter").addEventListener('click', saveFilterFromModal);

  // Close modals on background click
  $("#extractorModal").addEventListener('click', e => {
    if (e.target.id === 'extractorModal') closeExtractorModal();
  });
  $("#filterModal").addEventListener('click', e => {
    if (e.target.id === 'filterModal') closeFilterModal();
  });

  // Keyboard shortcuts for modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($("#extractorModal").classList.contains('active')) {
        closeExtractorModal();
      }
      if ($("#filterModal").classList.contains('active')) {
        closeFilterModal();
      }
    }
  });

  // Settings - Merge Strategy
  $("#mergeStrategy").addEventListener('change', e => {
    const prefs = Storage.getPrefs();
    prefs.extractorMergeStrategy = e.target.value;
    Storage.savePrefs(prefs);
  });

  // Saved Filters dropdown actions
  const sfSelect = $('#savedFilterSelect');
  if (sfSelect) {
    sfSelect.addEventListener('change', (e) => {
      // Selecting does not auto-apply — it only populates the Filters & Sort fields
      const id = e.target.value;
      const filter = Storage.getFilters().find(f => f.id === id);
      if (filter) loadFilterIntoUI(filter);
    });
  }

  const loadSavedFilterBtn = $('#loadSavedFilter');
  if (loadSavedFilterBtn) loadSavedFilterBtn.addEventListener('click', () => {
    const id = $('#savedFilterSelect').value;
    const filter = Storage.getFilters().find(f => f.id === id);
    if (filter) loadFilterIntoUI(filter);
  });

  const applySavedFilterBtn = $('#applySavedFilter');
  if (applySavedFilterBtn) applySavedFilterBtn.addEventListener('click', async () => {
    const id = $('#savedFilterSelect').value;
    const filter = Storage.getFilters().find(f => f.id === id);
    if (filter) {
      loadFilterIntoUI(filter);
      // parse advanced query and apply
      if ($('#textQuery').value.trim()) {
        try {
          const response = await sendToWorker('PARSE_ADVANCED_QUERY', { queryText: $('#textQuery').value.trim() }, true);
          if (response.data.success) {
            appliedAdvancedQuery = response.data.result;
            $('#queryError').textContent = '';
          } else {
            appliedAdvancedQuery = null;
            $('#queryError').textContent = 'Query parse error: ' + response.data.error;
            return;
          }
        } catch (err) {
          appliedAdvancedQuery = null;
          $('#queryError').textContent = 'Query parse error: ' + err.message;
          return;
        }
      } else {
        appliedAdvancedQuery = null;
      }
      // mark filter as applied
      appliedFilterConfig = currentFilterConfig ? JSON.parse(JSON.stringify(currentFilterConfig)) : null;
      applyFilters('saved-filtering');
    }
  });

  // Initialize UI
  // Clean up active extractors on load (remove deleted/invalid IDs)
  const activeIds = Storage.getActiveExtractors();
  Storage.setActiveExtractors(activeIds); // This will dedupe and validate
  // Migrate any old v1 filters to v2 format on startup
  migrateAllFilters();
  renderExtractorList();
  renderFilterList();
  updateExtractorInfo();
  updateFilterLibInfo();
  // Set timezone label and info
  const info = $('#tzInfo');
  if (info) info.textContent = `Timestamps are displayed in your local timezone (${userTimeZone}). Naive timestamps are treated as local; UTC/Zulu timestamps are converted to your timezone.`;
  initializeCollapsibles();
  initializeSettings();
  initializeSidebar();
  // Move previously top-level Help/Filters/Extractors into the Search Tools tabbed panel
  moveSearchContentIntoTabs();
}

/**
 * Move the content of existing top-level sections into tab panels and remove originals
 */
function moveSearchContentIntoTabs() {
  const names = ['help', 'filters', 'extractors'];
  names.forEach(name => {
    const old = document.getElementById(`section-${name}`);
    const panel = document.getElementById(`tab-${name}`);
    if (old && panel) {
      const content = old.querySelector('.section-content');
      if (content) {
        // Move the existing DOM node so event listeners are preserved
        panel.appendChild(content);
      }
      // Remove the old section node so it's not duplicated (content already moved)
      if (old.parentNode) old.parentNode.removeChild(old);
    }
  });

  // Init tab button behaviors
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const t = e.currentTarget.dataset.tab;
      showSearchTab(t);
    });
  });

  // Default open first tab (Filters & Sort) when Search Tools appears
  showSearchTab('filters');
}

// ---------- Settings ----------

/**
 * Initialize settings UI from saved preferences
 */
function initializeSettings() {
  const prefs = Storage.getPrefs();
  const mergeStrategySelect = $("#mergeStrategy");
  if (mergeStrategySelect) {
    mergeStrategySelect.value = prefs.extractorMergeStrategy || 'last-wins';
  }

  // Initialize page size from preferences
  per = prefs.defaultPageSize || 50;
  const perSelect = $("#per");
  if (perSelect) {
    perSelect.value = per;
  }
}

// ---------- Theme Toggle ----------

/**
 * Initialize theme based on saved preference or system preference
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('logsieve-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Use saved theme, or fall back to system preference (default to light)
  const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
  
  setTheme(isDark ? 'dark' : 'light');
}

/**
 * Set the theme and update UI
 * @param {string} theme - 'light' or 'dark'
 */
function setTheme(theme) {
  const root = document.documentElement;
  const themeIcon = $('#themeToggle .theme-icon');
  const themeIconSmall = $('#themeToggleSmall .theme-icon');
  
  if (theme === 'light') {
    root.classList.remove('dark-theme');
    themeIcon.textContent = '☀️';
    if (themeIconSmall) themeIconSmall.textContent = '☀️';
  } else {
    root.classList.add('dark-theme');
    themeIcon.textContent = '🌙';
    if (themeIconSmall) themeIconSmall.textContent = '🌙';
  }
  
  // Save preference
  localStorage.setItem('logsieve-theme', theme);
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark-theme');
  setTheme(isDark ? 'light' : 'dark');
}

/**
 * Initialize theme toggle functionality
 */
function initializeThemeToggle() {
  const themeToggle = $('#themeToggle');
  const themeToggleSmall = $('#themeToggleSmall');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  if (themeToggleSmall) {
    themeToggleSmall.addEventListener('click', toggleTheme);
  }
  
  // Initialize theme on page load
  initializeTheme();
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initWorker();
    initializeEventHandlers();
    initializeThemeToggle();
  });
} else {
  initWorker();
  initializeEventHandlers();
  initializeThemeToggle();
}