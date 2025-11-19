/**
 * LogSieve Worker - Data Processing Module
 * Handles heavy computations in a Web Worker to keep UI responsive
 */

importScripts('shared.js');

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

// ---------- Field Registry & Operators ----------
// (Moved to shared.js)

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
// (Moved to shared.js)

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
  self.onmessage = function (e) {
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
              fieldNames: [...fieldNames],
              fieldRegistry: FieldRegistry.serialize()
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
              newFieldNames: [...fieldNames],
              fieldRegistry: FieldRegistry.serialize()
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