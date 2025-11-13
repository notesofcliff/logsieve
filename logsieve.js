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
  // ISO-ish yyyy-mm-dd[ T]hh:mm:ss(.sss)?
  const m = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/);
  if (!m) return "";
  const iso = m[1].replace(" ", "T").replace(",", ".");
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString();
}

/**
 * Remove timestamp prefix from log line
 * @param {string} line - Log line text
 * @returns {string} - Line without timestamp prefix
 */
function stripPrefix(line) {
  return line.replace(/^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/, "");
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
let fieldNames = new Set();  // Track all extracted field names

/**
 * Parse raw log text into structured log entries
 * @param {string} text - Raw log file content
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseLogText(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let id = 1;

  for (const line of lines) {
    if (!line.trim()) continue;

    const ts = tryTs(line);
    const level = guessLevel(line);
    const msg = stripPrefix(line);

    out.push({
      id: id++,
      ts,
      level,
      message: msg,
      raw: line,
      fields: {},
      _lc: (line + " " + msg).toLowerCase() // Lowercase for search
    });
  }

  return out;
}

/**
 * Parse CSV data into structured log entries
 * @param {string} text - CSV file content
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseCSV(text) {
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
      const d = new Date(values[tsIdx]);
      row.ts = isNaN(d) ? values[tsIdx] : d.toISOString();
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

  return out;
}

/**
 * Parse JSON data into structured log entries
 * @param {string} text - JSON file content
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseJSON(text) {
  const out = [];
  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse JSON:', e);
    alert('Invalid JSON file: ' + e.message);
    return out;
  }

  // Handle both single object and array of objects
  const items = Array.isArray(data) ? data : [data];
  
  let rowId = 1;
  for (const item of items) {
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
      const d = new Date(tsVal);
      row.ts = isNaN(d) ? String(tsVal) : d.toISOString();
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

  return out;
}

/**
 * Apply all active filters to the dataset
 */
function applyFilters() {
  const q = $("#q").value.trim().toLowerCase();
  const lv = $("#level").value;
  const from = $("#from").value ? new Date($("#from").value).toISOString() : "";
  const to = $("#to").value ? new Date($("#to").value).toISOString() : "";
  const regex = $("#regex").value.trim();

  let re = null;
  if (regex) {
    try {
      re = new RegExp(regex);
    } catch (e) {
      alert("Invalid regex: " + e.message);
    }
  }

  let v = rows;

  // Apply filters
  if (lv) v = v.filter(r => r.level === lv);
  if (from) v = v.filter(r => !r.ts || r.ts >= from);
  if (to) v = v.filter(r => !r.ts || r.ts <= to);

  // Text search
  if (q) {
    const terms = q.split(/\s+/);
    v = v.filter(r => terms.every(t => r._lc.includes(t)));
  }

  // Regex filter
  if (re) {
    v = v.filter(r => re.test(r.raw));
  }

  // Sort results
  const sort = $("#sort").value;
  const ord = $("#order").value;
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
  page = 1;
  render();
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
  const t0 = performance.now();
  const body = $("#tbody");
  const theadRow = $("#thead-row");
  body.innerHTML = "";

  // Update table headers with dynamic field columns
  const sortedFields = [...fieldNames].sort();
  theadRow.innerHTML = `
    <th style="width:72px">ID</th>
    <th style="width:210px">Timestamp</th>
    <th style="width:120px">Level</th>
    <th>Message</th>
    ${sortedFields.map(f => `<th style="min-width:150px">${escapeHtml(f)}</th>`).join('')}
  `;

  const pageRows = paginate(view);
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
      <td>${r.ts ? r.ts.replace('T', ' ').replace('Z', '') : ''}</td>
      <td><span class="lvl-${r.level}">${r.level || ''}</span></td>
      <td><pre>${escapeHtml(r.message)}</pre><details><summary>raw</summary><pre>${escapeHtml(r.raw)}</pre></details></td>
      ${fieldCells}`;
    frag.appendChild(tr);
  }

  body.appendChild(frag);

  // Update UI elements
  $("#pageLabel").textContent = `${page} / ${Math.max(1, Math.ceil(view.length / per))}`;
  $("#renderInfo").textContent = `${fmt(view.length)} rows · showing ${fmt(pageRows.length)} · ${Math.round(performance.now() - t0)}ms`;
  $("#countTag").textContent = `${fmt(rows.length)} lines`;

  updateFilterTag();
  renderStats();
}

/**
 * Update the filter status tag
 */
function updateFilterTag() {
  const bits = [];
  if ($("#q").value.trim()) bits.push('q');
  if ($("#level").value) bits.push($("#level").value);
  if ($("#from").value) bits.push('from');
  if ($("#to").value) bits.push('to');
  if ($("#regex").value.trim()) bits.push('re');
  $("#filterTag").textContent = bits.length ? `filters: ${bits.join(',')}` : 'no filters';
}

/**
 * Render statistics and sparkline chart
 */
function renderStats() {
  $("#sRows").textContent = fmt(view.length);
  $("#sInfo").textContent = fmt(view.filter(r => r.level === 'INFO').length);
  $("#sWarn").textContent = fmt(view.filter(r => r.level === 'WARNING').length);
  $("#sErr").textContent = fmt(view.filter(r => r.level === 'ERROR').length);

  // Create time-bucket sparkline (per minute)
  const buckets = new Map();
  for (const r of view) {
    if (!r.ts) continue;
    const k = r.ts.slice(0, 16); // YYYY-MM-DDTHH:MM
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }

  const pairs = [...buckets.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  drawSpark($("#spark"), pairs.map(p => p[1]));
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
      const d = new Date(groupValues.ts[0]);
      if (!isNaN(d)) r.ts = d.toISOString();
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

  const scope = $("#extractScope").value === 'filtered' ? view : rows;
  const results = runMultipleExtractors(activeExtractors, scope);
  
  console.log('Extractor results:', results);

  $("#extractInfo").textContent = `Applied ${activeExtractors.length} extractor(s) to ${fmt(scope.length)} rows · ${fmt(results.total)} matches`;
  updateSortOptions();
  applyFilters();
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

  const text = await readFileAsText(file);
  const format = detectFileFormat(file.name);
  
  // Clear existing field names for new file
  fieldNames.clear();
  
  // Route to appropriate parser
  switch (format) {
    case 'csv':
      rows = parseCSV(text);
      $("#info").textContent = `Parsed ${fmt(rows.length)} rows from CSV`;
      break;
    case 'json':
      rows = parseJSON(text);
      $("#info").textContent = `Parsed ${fmt(rows.length)} records from JSON`;
      break;
    default:
      rows = parseLogText(text);
      $("#info").textContent = `Parsed ${fmt(rows.length)} lines from log file`;
      break;
  }

  applyFilters();
}

// ---------- Export Functions ----------

/**
 * Export current view as JSON file
 */
function exportJSON() {
  const blob = new Blob([JSON.stringify(view, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'logsieve-data.json';
  a.click();
}

/**
 * Export current view as CSV file
 */
function exportCSV() {
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
    if (filter.query) settings.push(`q: ${filter.query}`);
    if (filter.level) settings.push(`level: ${filter.level}`);
    if (filter.from) settings.push('has from');
    if (filter.to) settings.push('has to');
    if (filter.regex) settings.push('has regex');

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

  // Show current filter settings
  const preview = $("#filterPreview");
  const settings = [];
  
  const q = $("#q").value.trim();
  const level = $("#level").value;
  const from = $("#from").value;
  const to = $("#to").value;
  const regex = $("#regex").value.trim();
  const sort = $("#sort").value;
  const order = $("#order").value;

  if (q) settings.push(`Search: "${q}"`);
  if (level) settings.push(`Level: ${level}`);
  if (from) settings.push(`From: ${from}`);
  if (to) settings.push(`To: ${to}`);
  if (regex) settings.push(`Regex: ${regex}`);
  settings.push(`Sort: ${sort} (${order})`);

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
    query: $("#q").value.trim(),
    level: $("#level").value,
    from: $("#from").value,
    to: $("#to").value,
    regex: $("#regex").value.trim(),
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

  // Apply filter settings to UI
  $("#q").value = filter.query || '';
  $("#level").value = filter.level || '';
  $("#from").value = filter.from || '';
  $("#to").value = filter.to || '';
  $("#regex").value = filter.regex || '';
  $("#sort").value = filter.sort || 'id';
  $("#order").value = filter.order || 'desc';

  // Trigger filter application
  applyFilters();
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
}

/**
 * Initialize collapsible sections
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

// ---------- Event Handlers ----------

/**
 * Initialize all event listeners when DOM is ready
 */
function initializeEventHandlers() {
  // Filter controls
  ["q", "level", "from", "to", "regex", "sort", "order", "per"].forEach(id =>
    $("#" + id).addEventListener('change', applyFilters)
  );

  // Action buttons
  $("#apply").addEventListener('click', e => {
    e.preventDefault();
    applyFilters();
  });

  $("#clear").addEventListener('click', e => {
    e.preventDefault();
    ["q", "level", "from", "to", "regex"].forEach(id => $("#" + id).value = '');
    applyFilters();
  });

  // Pagination
  $("#prev").addEventListener('click', () => {
    if (page > 1) {
      page--;
      render();
    }
  });

  $("#next").addEventListener('click', () => {
    const max = Math.max(1, Math.ceil(view.length / per));
    if (page < max) {
      page++;
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

  // Initialize UI
  // Clean up active extractors on load (remove deleted/invalid IDs)
  const activeIds = Storage.getActiveExtractors();
  Storage.setActiveExtractors(activeIds); // This will dedupe and validate
  
  renderExtractorList();
  renderFilterList();
  updateExtractorInfo();
  updateFilterLibInfo();
  initializeCollapsibles();
  initializeSettings();
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
}

// ---------- Theme Toggle ----------

/**
 * Initialize theme based on saved preference or system preference
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('logsieve-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Use saved theme, or fall back to system preference (default to dark)
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
  
  if (theme === 'light') {
    root.classList.add('light-theme');
    themeIcon.textContent = '☀️';
  } else {
    root.classList.remove('light-theme');
    themeIcon.textContent = '🌙';
  }
  
  // Save preference
  localStorage.setItem('logsieve-theme', theme);
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  const isLight = document.documentElement.classList.contains('light-theme');
  setTheme(isLight ? 'dark' : 'light');
}

/**
 * Initialize theme toggle functionality
 */
function initializeThemeToggle() {
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // Initialize theme on page load
  initializeTheme();
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeEventHandlers();
    initializeThemeToggle();
  });
} else {
  initializeEventHandlers();
  initializeThemeToggle();
}