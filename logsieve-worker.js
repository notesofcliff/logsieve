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

// Parsing State (for chunked processing)
let parserState = {
  buffer: '',          // Remainder from previous chunk
  currentEntry: null,  // Current multi-line entry being built
  id: 1,               // Next row ID
  totalBytes: 0,       // Total bytes processed
  startTime: 0         // Start time for performance tracking
};

// ---------- Utilities ----------

/**
 * Simple utility to check if running in worker context
 */
const isWorker = typeof self !== 'undefined' && typeof window === 'undefined';

// ---------- Data Parsing ----------

/**
 * Reset parser state
 */
function resetParserState() {
  parserState = {
    buffer: '',
    currentEntry: null,
    id: 1,
    totalBytes: 0,
    startTime: performance.now()
  };
  rows = [];
  fieldNames.clear();
}

/**
 * Parse a chunk of log text
 * @param {string} chunk - New text chunk
 * @param {boolean} isLast - Whether this is the last chunk
 * @param {function} progressCallback - Callback for progress
 */
function parseLogChunk(chunk, isLast, progressCallback = null) {
  // Append new chunk to buffer
  parserState.buffer += chunk;
  parserState.totalBytes += chunk.length;

  // Find the last newline to safely process up to that point
  // If it's the last chunk, we process everything
  let lastNewlineIndex = parserState.buffer.lastIndexOf('\n');

  if (!isLast && lastNewlineIndex === -1) {
    // No newline in this chunk and not the last one? Wait for more data.
    return;
  }

  let textToProcess;
  if (isLast) {
    textToProcess = parserState.buffer;
    parserState.buffer = '';
  } else {
    textToProcess = parserState.buffer.substring(0, lastNewlineIndex);
    parserState.buffer = parserState.buffer.substring(lastNewlineIndex + 1);
  }

  const lines = textToProcess.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines unless it's inside a multi-line message (though usually we trim)
    if (!line.trim()) continue;

    // Check if this is a continuation of the previous entry
    if (parserState.currentEntry && isContinuationLine(line)) {
      // Append to current entry's raw and message
      parserState.currentEntry.raw += '\n' + line;
      parserState.currentEntry.message += '\n' + line;
      // Update search index
      parserState.currentEntry._lc = (parserState.currentEntry.raw + " " + parserState.currentEntry.message).toLowerCase();
      continue;
    }

    // If we have a current entry, save it before starting a new one
    if (parserState.currentEntry) {
      rows.push(parserState.currentEntry);
    }

    // Start a new entry
    const ts = tryTs(line);
    const level = guessLevel(line);
    const msg = stripPrefix(line) || line; // Use full line if no prefix found

    parserState.currentEntry = {
      id: parserState.id++,
      ts,
      level,
      message: msg,
      raw: line,
      fields: {},
      _lc: (line + " " + msg).toLowerCase() // Lowercase for search
    };
  }

  // If this is the last chunk, push the final entry
  if (isLast && parserState.currentEntry) {
    rows.push(parserState.currentEntry);
    parserState.currentEntry = null;
  }
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
              row.fields[header] = values[idx];
              fieldNames.add(header);
            }
          } else {
            row.fields[header] = values[idx];
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
        if (Array.isArray(value)) {
          row.fields[key] = value;
        } else if (value !== null && value !== undefined) {
          row.fields[key] = value;
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
          row.fields[key] = value;
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

// `runSingleExtractor` and `runMultipleExtractors` are provided by `shared.js` (imported at top).

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
        case 'PARSE_CHUNK': {
          const { chunk, format } = data;
          // Currently only supporting chunked parsing for raw logs
          // CSV/JSON still use whole-file parsing for now as they are harder to chunk safely
          if (format !== 'log' && format !== 'txt') {
            // Accumulate in buffer for non-log formats
            parserState.buffer += chunk;
            break;
          }

          parseLogChunk(chunk, false);
          break;
        }

        case 'PARSE_END': {
          const { format } = data;

          if (format === 'csv') {
            rows = parseCSV(parserState.buffer);
          } else if (format === 'json') {
            rows = parseJSON(parserState.buffer);
          } else {
            // Finalize log parsing
            parseLogChunk('', true);
          }

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

        case 'PARSE_START': {
          resetParserState();
          break;
        }

        case 'PARSE_DATA': {
          // Legacy one-shot parsing
          const { text, format } = data;
          resetParserState();

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
              // Use the new chunk logic but for the whole file
              parseLogChunk(text, true);
              parsedRows = rows;
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

        case 'COMPUTE_SUMMARY_STATS': {
          const progressCallback = (percent, message) => {
            self.postMessage({
              type: 'PROGRESS',
              data: { percent, message, operation: 'summary' },
              id
            });
          };
          const stats = computeSummaryStats(view, FieldRegistry, progressCallback);
          self.postMessage({
            type: 'SUMMARY_STATS_COMPLETE',
            data: stats,
            id
          });
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

function computeSummaryStats(view, fieldRegistry, progressCallback) {
  const allFields = ['id', 'ts', 'level', 'message', 'raw', ...Array.from(fieldNames)];
  const result = {};
  let fieldIndex = 0;
  const totalFields = allFields.length;
  for (const field of allFields) {
    progressCallback(Math.round((fieldIndex / totalFields) * 100), `Computing stats for ${field}...`);
    const fieldStats = computeFieldStats(view, field, fieldRegistry.get(field));
    result[field] = fieldStats;
    fieldIndex++;
  }
  return result;
}

function computeFieldStats(view, fieldName, fieldMeta) {
  const values = [];
  for (const row of view) {
    let val;
    if (['id', 'ts', 'level', 'message', 'raw'].includes(fieldName)) {
      val = row[fieldName];
    } else {
      val = row.fields?.[fieldName];
    }
    if (val !== undefined && val !== null && val !== '') {
      values.push(val);
    }
  }
  const withValue = values.length;
  const withoutValue = view.length - withValue;
  const uniqueMap = new Map();
  for (const val of values) {
    let key;
    try {
      key = Array.isArray(val) || (typeof val === 'object' && val !== null) ? JSON.stringify(val) : String(val);
    } catch {
      key = '[unserializable]';
    }
    uniqueMap.set(key, (uniqueMap.get(key) || 0) + 1);
  }
  const unique = uniqueMap.size;
  const type = fieldMeta?.type || 'unknown';
  const stats = { type, withValue, withoutValue, unique };
  if (type === 'array' || (typeof values[0] === 'object' && values[0] !== null && !Array.isArray(values[0]))) {
    return stats; // only general
  }
  if (type === 'numeric') {
    const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n));
    if (nums.length === 0) return stats;
    const sorted = nums.sort((a, b) => a - b);
    stats.min = sorted[0];
    stats.max = sorted[sorted.length - 1];
    stats.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const mid = Math.floor(sorted.length / 2);
    stats.median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const freq = {};
    for (const n of nums) {
      freq[n] = (freq[n] || 0) + 1;
    }
    let mode = null;
    let maxFreq = 0;
    for (const [n, f] of Object.entries(freq)) {
      if (f > maxFreq) {
        maxFreq = f;
        mode = parseFloat(n);
      }
    }
    stats.mode = mode;
  } else if (type === 'date') {
    const dates = values.map(v => new Date(v)).filter(d => !isNaN(d.getTime()));
    if (dates.length === 0) return stats;
    const isos = dates.map(d => d.toISOString()).sort();
    stats.earliest = isos[0];
    stats.latest = isos[isos.length - 1];
  } else if (type === 'text') {
    const strs = values.map(v => String(v));
    if (strs.length === 0) return stats;
    const lengths = strs.map(s => s.length);
    stats.minLen = Math.min(...lengths);
    stats.maxLen = Math.max(...lengths);
    stats.avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const freq = {};
    for (const s of strs) {
      freq[s] = (freq[s] || 0) + 1;
    }
    const sortedFreq = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    stats.mostCommon = sortedFreq.slice(0, 3).map(([val, count]) => ({ val, count }));
  }
  return stats;
}