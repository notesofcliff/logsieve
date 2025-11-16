/**
 * LogSieve Worker - Data Processing Module
 * Handles heavy computations in a Web Worker to keep UI responsive
 */

// ---------- Data Model ----------

let rows = [];        // Full dataset
let view = [];        // Filtered/sorted view
let fieldNames = new Set();  // Track all extracted field names
let currentFilterConfig = null;
let appliedFilterConfig = null;
let appliedAdvancedQuery = null;

// ---------- Utilities ----------

/**
 * Simple utility to check if running in worker context
 */
const isWorker = typeof self !== 'undefined' && typeof window === 'undefined';

/**
 * Format number with locale-specific formatting
 * @param {number} n - Number to format
 * @returns {string} - Formatted number
 */
const fmt = (n) => n.toLocaleString();

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
}/**
 * Tokenize string for search purposes
 * @param {string} s - String to tokenize
 * @returns {Array<string>} - Array of tokens
 */
function tokenize(s) {
  return s.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}

// ---------- Data Parsing ----------

/**
 * Parse raw log text into structured log entries
 * Supports multi-line events (tracebacks, stack traces)
 * @param {string} text - Raw log file content
 * @param {function} progressCallback - Optional callback for progress updates
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseLogText(text, progressCallback = null) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let id = 1;
  let currentEntry = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Send progress update every 1000 lines
    if (progressCallback && i % 1000 === 0) {
      progressCallback(Math.round((i / lines.length) * 100), `Parsing ${fmt(i)}/${fmt(lines.length)} lines...`);
    }

    // Check if this is a continuation of the previous entry
    if (currentEntry && isContinuationLine(line)) {
      // Append to current entry's raw and message
      currentEntry.raw += '\n' + line;
      currentEntry.message += '\n' + line;
      // Update search index
      currentEntry._lc = (currentEntry.raw + " " + currentEntry.message).toLowerCase();
      continue;
    }

    // If we have a current entry, save it before starting a new one
    if (currentEntry) {
      out.push(currentEntry);
    }

    // Start a new entry
    const ts = tryTs(line);
    const level = guessLevel(line);
    const msg = stripPrefix(line) || line; // Use full line if no prefix found

    currentEntry = {
      id: id++,
      ts,
      level,
      message: msg,
      raw: line,
      fields: {},
      _lc: (line + " " + msg).toLowerCase() // Lowercase for search
    };
  }

  // Don't forget the last entry
  if (currentEntry) {
    out.push(currentEntry);
  }

  if (progressCallback) {
    progressCallback(100, `Parsed ${fmt(out.length)} entries`);
  }

  return out;
}

/**
 * Parse CSV data into structured log entries
 * @param {string} text - CSV file content
 * @param {function} progressCallback - Optional callback for progress updates
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseCSV(text, progressCallback = null) {
  const out = [];
  const lines = text.split(/\r?\n/).filter(line => line.trim());

  if (lines.length === 0) return out;

  // Parse CSV (basic implementation, handles quoted fields)
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Parse header
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());

  // Find standard column indices
  const idIdx = headers.findIndex(h => h === 'id');
  const tsIdx = headers.findIndex(h => h === 'ts' || h === 'timestamp' || h === 'time' || h === 'date');
  const levelIdx = headers.findIndex(h => h === 'level' || h === 'severity' || h === 'loglevel');
  const msgIdx = headers.findIndex(h => h === 'message' || h === 'msg' || h === 'text' || h === 'description');
  const rawIdx = headers.findIndex(h => h === 'raw');

  // Parse data rows
  let rowId = 1;
  for (let i = 1; i < lines.length; i++) {
    // Send progress update every 1000 rows
    if (progressCallback && i % 1000 === 0) {
      progressCallback(Math.round((i / lines.length) * 100), `Parsing ${fmt(i)}/${fmt(lines.length)} rows...`);
    }

    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;

    const row = {
      id: idIdx >= 0 && values[idIdx] ? parseInt(values[idIdx]) : rowId++,
      ts: '',
      level: '',
      message: '',
      raw: '',
      fields: {},
      _lc: ''
    };

    // Map standard columns
    if (tsIdx >= 0 && values[tsIdx]) {
      row.ts = parseTimestampToISO(values[tsIdx]) || values[tsIdx];
    }

    if (levelIdx >= 0 && values[levelIdx]) {
      row.level = values[levelIdx].toUpperCase();
      if (row.level === 'WARN') row.level = 'WARNING';
    }

    if (msgIdx >= 0 && values[msgIdx]) {
      row.message = values[msgIdx];
    }

    if (rawIdx >= 0 && values[rawIdx]) {
      row.raw = values[rawIdx];
    } else {
      // If no raw column, reconstruct from all values
      row.raw = values.join(' | ');
    }

    // Map remaining columns as fields
    headers.forEach((header, idx) => {
      if (idx !== idIdx && idx !== tsIdx && idx !== levelIdx && idx !== msgIdx && idx !== rawIdx) {
        if (values[idx]) {
          // Parse JSON arrays if present
          if (values[idx].startsWith('[') && values[idx].endsWith(']')) {
            try {
              row.fields[header] = JSON.parse(values[idx]);
              fieldNames.add(header);
            } catch (e) {
              row.fields[header] = [values[idx]];
              fieldNames.add(header);
            }
          } else {
            row.fields[header] = [values[idx]];
            fieldNames.add(header);
          }
        }
      }
    });

    // Build search index
    row._lc = (row.raw + " " + row.message + " " + Object.values(row.fields).flat().join(" ")).toLowerCase();
    out.push(row);
  }

  if (progressCallback) {
    progressCallback(100, `Parsed ${fmt(out.length)} entries`);
  }

  return out;
}

/**
 * Parse JSON data into structured log entries
 * @param {string} text - JSON file content
 * @param {function} progressCallback - Optional callback for progress updates
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseJSON(text, progressCallback = null) {
  const out = [];
  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse JSON:', e);
    throw new Error('Invalid JSON file: ' + e.message);
  }

  // Handle both single object and array of objects
  const items = Array.isArray(data) ? data : [data];

  let rowId = 1;
  for (let i = 0; i < items.length; i++) {
    // Send progress update every 1000 items
    if (progressCallback && i % 1000 === 0) {
      progressCallback(Math.round((i / items.length) * 100), `Parsing ${fmt(i)}/${fmt(items.length)} items...`);
    }

    const item = items[i];
    if (typeof item !== 'object' || item === null) continue;

    const row = {
      id: item.id !== undefined ? item.id : rowId++,
      ts: '',
      level: '',
      message: '',
      raw: '',
      fields: {},
      _lc: ''
    };

    // Map standard properties
    if (item.ts || item.timestamp || item.time || item.date) {
      const tsVal = item.ts || item.timestamp || item.time || item.date;
      row.ts = parseTimestampToISO(tsVal) || String(tsVal);
    }

    if (item.level || item.severity || item.loglevel) {
      row.level = String(item.level || item.severity || item.loglevel).toUpperCase();
      if (row.level === 'WARN') row.level = 'WARNING';
    }

    if (item.message || item.msg || item.text || item.description) {
      row.message = String(item.message || item.msg || item.text || item.description);
    }

    if (item.raw) {
      row.raw = String(item.raw);
    } else {
      // Reconstruct raw from JSON
      row.raw = JSON.stringify(item);
    }

    // Map remaining properties as fields
    const standardProps = new Set(['id', 'ts', 'timestamp', 'time', 'date', 'level', 'severity',
                                    'loglevel', 'message', 'msg', 'text', 'description', 'raw', '_lc']);

    for (const [key, value] of Object.entries(item)) {
      if (!standardProps.has(key)) {
        // Wrap values in arrays for consistency with extractor output
        if (Array.isArray(value)) {
          row.fields[key] = value;
        } else if (value !== null && value !== undefined) {
          row.fields[key] = [String(value)];
        }
        fieldNames.add(key);
      }
    }

    // Also handle nested 'fields' object if present
    if (item.fields && typeof item.fields === 'object') {
      for (const [key, value] of Object.entries(item.fields)) {
        if (Array.isArray(value)) {
          row.fields[key] = value;
        } else if (value !== null && value !== undefined) {
          row.fields[key] = [String(value)];
        }
        fieldNames.add(key);
      }
    }

    // Build search index
    row._lc = (row.raw + " " + row.message + " " + Object.values(row.fields).flat().join(" ")).toLowerCase();
    out.push(row);
  }

  if (progressCallback) {
    progressCallback(100, `Parsed ${fmt(out.length)} entries`);
  }

  return out;
}

// ---------- Field Registry & Operators ----------

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

function applyFilterConfig(rows, filterConfig, progressCallback = null) {
  let filteredRows = rows;
  if (filterConfig.quickSearch && filterConfig.quickSearch.trim()) {
    if (progressCallback) progressCallback(10, 'Applying quick search...');
    const terms = filterConfig.quickSearch.toLowerCase().split(/\s+/);
    filteredRows = filteredRows.filter(row => terms.every(t => row._lc.includes(t)));
  }
  if (filterConfig.rules && filterConfig.rules.length > 0) {
    if (progressCallback) progressCallback(30, 'Applying filter rules...');
    filteredRows = filteredRows.filter(row => evaluateRules(row, filterConfig.rules));
  }
  if (filterConfig.groups && filterConfig.groups.length > 0) {
    if (progressCallback) progressCallback(50, 'Applying filter groups...');
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
 * @param {function} progressCallback - Optional callback for progress updates
 * @returns {Object} - Results summary
 */
function runMultipleExtractors(extractors, scope, progressCallback = null) {
  const mergeStrategy = 'last-wins'; // Default for now, could be configurable

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

  for (let i = 0; i < sorted.length; i++) {
    const extractor = sorted[i];

    // Send progress update
    if (progressCallback) {
      const percent = Math.round(((i + 1) / sorted.length) * 100);
      progressCallback(percent, `Running extractor ${i + 1}/${sorted.length}: ${extractor.name}`);
    }

    // Skip disabled extractors
    if (extractor.enabled === false) {
      console.log('Skipping disabled extractor:', extractor.name);
      continue;
    }

    console.log('Running extractor:', extractor.name, 'Pattern:', extractor.pattern);
    const hits = runSingleExtractor(extractor.pattern, scope, mergeStrategy);
    console.log('Extractor', extractor.name, 'matched', hits, 'rows');
    results.byExtractor[extractor.id] = hits;
    results.total += hits;
  }

  if (progressCallback) {
    progressCallback(100, `Completed ${sorted.length} extractors · ${fmt(results.total)} matches`);
  }

  return results;
}

// ---------- Query Parser ----------

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

function parseAdvancedQuery(queryText) {
  if (!queryText || !queryText.trim()) return null;
  try {
    const parser = new QueryParser(queryText);
    const rules = parser.parse();
    // words are treated as quick search tokens
    const words = parser.tokens.filter(t => t.type === 'WORD').map(t => t.value);
    return { version: 2, rules, quickSearch: words.join(' ') };
  } catch (e) {
    throw new Error('Query parse error: ' + (e.message || e));
  }
}

// ---------- Processing Functions ----------

/**
 * Apply all active filters to the dataset
 */
function applyFilters(sortConfig, progressCallback = null) {
  // Builder rules are stored in appliedFilterConfig

  let v = rows;

  // Builder: if configured via builder, apply structured filter on top first
  if (appliedFilterConfig && (appliedFilterConfig.rules && appliedFilterConfig.rules.length > 0)) {
    v = applyFilterConfig(v, appliedFilterConfig, progressCallback);
  }

  // Advanced: apply only if the user pressed Apply (appliedAdvancedQuery)
  if (appliedAdvancedQuery) {
    v = applyFilterConfig(v, appliedAdvancedQuery, progressCallback);
  }

  // Sort results
  if (progressCallback) progressCallback(70, 'Sorting results...');
  const sort = sortConfig.field;
  const ord = sortConfig.order;
  v = v.slice().sort((a, b) => {
    let A, B;

    // Check if sorting by a field column
    if (sort.startsWith('field:')) {
      const fieldName = sort.substring(6);
      const aVal = a.fields?.[fieldName];
      const bVal = b.fields?.[fieldName];

      // Handle arrays - use first element or stringify
      A = Array.isArray(aVal) ? (aVal.length > 0 ? aVal[0] : '') : (aVal || '');
      B = Array.isArray(bVal) ? (bVal.length > 0 ? bVal[0] : '') : (bVal || '');
    } else {
      A = a[sort] || "";
      B = b[sort] || "";
    }

    if (A < B) return ord === 'asc' ? -1 : 1;
    if (A > B) return ord === 'asc' ? 1 : -1;
    return 0;
  });

  view = v;
  if (progressCallback) progressCallback(100, 'Filtering complete');
  return view;
}

/**
 * Compute statistics for the current view
 */
function computeStats() {
  const stats = {
    totalRows: view.length,
    infoCount: view.filter(r => r.level === 'INFO').length,
    warnCount: view.filter(r => r.level === 'WARNING').length,
    errorCount: view.filter(r => r.level === 'ERROR').length,
    timeBuckets: []
  };

  // Create time-bucket sparkline (per minute)
  const buckets = new Map();
  for (const r of view) {
    if (!r.ts) continue;
    const k = r.ts.slice(0, 16); // YYYY-MM-DDTHH:MM
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }

  stats.timeBuckets = [...buckets.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(p => p[1]);
  return stats;
}

/**
 * Get paginated data for rendering
 */
function getPageData(pageNum, perPage) {
  const start = (pageNum - 1) * perPage;
  const pageRows = view.slice(start, start + perPage);
  return {
    pageRows,
    totalPages: Math.max(1, Math.ceil(view.length / perPage)),
    currentPage: pageNum,
    totalRows: view.length
  };
}

// ---------- Worker Message Handler ----------

if (isWorker) {
  self.onmessage = function(e) {
    const { type, data, id } = e.data;

    try {
      switch (type) {
        case 'PARSE_DATA': {
          const { text, format } = data;
          fieldNames.clear();

          let parsedRows;
          const progressCallback = (percent, message) => {
            self.postMessage({
              type: 'PROGRESS',
              data: { percent, message, operation: 'parsing' },
              id
            });
          };

          switch (format) {
            case 'csv':
              parsedRows = parseCSV(text, progressCallback);
              break;
            case 'json':
              parsedRows = parseJSON(text, progressCallback);
              break;
            default:
              parsedRows = parseLogText(text, progressCallback);
              break;
          }

          rows = parsedRows;
          FieldRegistry.updateFromDataset(rows);

          self.postMessage({
            type: 'PARSE_COMPLETE',
            data: {
              rowCount: rows.length,
              fieldNames: [...fieldNames]
            },
            id
          });
          break;
        }

        case 'APPLY_FILTERS': {
          const { builder, advanced, sort, operation = 'filtering' } = data;
          appliedFilterConfig = builder;
          appliedAdvancedQuery = advanced;
          const progressCallback = (percent, message) => {
            self.postMessage({
              type: 'PROGRESS',
              data: { percent, message, operation },
              id
            });
          };
          const filteredView = applyFilters(sort, progressCallback);
          const stats = computeStats();

          self.postMessage({
            type: 'FILTER_COMPLETE',
            data: {
              viewLength: view.length,
              stats
            },
            id
          });
          break;
        }

        case 'RUN_EXTRACTORS': {
          const { extractors, scope } = data;
          const targetRows = scope === 'filtered' ? view : rows;
          const progressCallback = (percent, message) => {
            self.postMessage({
              type: 'PROGRESS',
              data: { percent, message, operation: 'extracting' },
              id
            });
          };
          const results = runMultipleExtractors(extractors, targetRows, progressCallback);

          // Update field registry after extraction
          FieldRegistry.updateFromDataset(rows);

          self.postMessage({
            type: 'EXTRACTORS_COMPLETE',
            data: {
              results,
              newFieldNames: [...fieldNames]
            },
            id
          });
          break;
        }

        case 'GET_PAGE': {
          const { page, per } = data;
          const pageData = getPageData(page, per);

          self.postMessage({
            type: 'PAGE_DATA',
            data: pageData,
            id
          });
          break;
        }

        case 'GET_STATS': {
          const stats = computeStats();
          self.postMessage({
            type: 'STATS_DATA',
            data: stats,
            id
          });
          break;
        }

        case 'GET_FULL_VIEW': {
          self.postMessage({
            type: 'FULL_VIEW_DATA',
            data: view,
            id
          });
          break;
        }

        case 'PARSE_ADVANCED_QUERY': {
          const { queryText } = data;
          try {
            const result = parseAdvancedQuery(queryText);
            self.postMessage({
              type: 'PARSE_QUERY_RESULT',
              data: { success: true, result },
              id
            });
          } catch (error) {
            self.postMessage({
              type: 'PARSE_QUERY_RESULT',
              data: { success: false, error: error.message },
              id
            });
          }
          break;
        }

        default:
          self.postMessage({
            type: 'ERROR',
            data: { message: 'Unknown message type: ' + type },
            id
          });
      }
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        data: { message: error.message, stack: error.stack },
        id
      });
    }
  };
}