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

// ---------- Data Model ----------

let rows = [];        // Full dataset
let view = [];        // Filtered/sorted view
let page = 1;         // Current page number
let per = 50;         // Items per page

/**
 * Parse raw text into structured log entries
 * @param {string} text - Raw log file content
 * @returns {Array<Object>} - Array of parsed log entries
 */
function parseText(text) {
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
    const A = a[sort] || "";
    const B = b[sort] || "";
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
  body.innerHTML = "";

  const pageRows = paginate(view);
  const frag = document.createDocumentFragment();

  for (const r of pageRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${r.ts ? r.ts.replace('T', ' ').replace('Z', '') : ''}</td>
      <td><span class="lvl-${r.level}">${r.level || ''}</span></td>
      <td><pre>${escapeHtml(r.message)}</pre><details><summary>raw</summary><pre>${escapeHtml(r.raw)}</pre></details></td>
      <td><code>${escapeHtml(JSON.stringify(r.fields || {}, null, 0))}</code></td>`;
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
 * Run regex extractor on log data to extract structured fields
 */
function runExtractor() {
  const pattern = $("#extractPattern").value.trim();
  if (!pattern) {
    alert('Provide a named‑group regex.');
    return;
  }

  let re;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    alert('Invalid regex: ' + e.message);
    return;
  }

  const scope = $("#extractScope").value === 'filtered' ? view : rows;
  let hits = 0;

  for (const r of scope) {
    const m = r.raw.match(re);
    if (!m) continue;

    const g = m.groups || {};
    if (Object.keys(g).length) {
      r.fields = Object.assign({}, r.fields, g);
      hits++;
    }

    // Update structured fields if captured
    if (g.ts) {
      const d = new Date(g.ts);
      if (!isNaN(d)) r.ts = d.toISOString();
    }
    if (g.level) {
      r.level = String(g.level).toUpperCase();
      if (r.level === 'WARN') r.level = 'WARNING';
    }
    if (g.message) {
      r.message = g.message;
    }
  }

  $("#extractInfo").textContent = `Applied to ${fmt(scope.length)} rows · ${fmt(hits)} with captures`;
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
 * Handle uploaded file and parse it
 * @param {File} file - File object to process
 */
async function handleFile(file) {
  $("#fileTag").textContent = file.name;
  $("#info").textContent = 'Parsing…';

  const text = await readFileAsText(file);
  rows = parseText(text);

  $("#info").textContent = `Parsed ${fmt(rows.length)} lines`;
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
  a.download = 'logsieve.json';
  a.click();
}

/**
 * Export current view as CSV file
 */
function exportCSV() {
  const header = ['id', 'ts', 'level', 'message', 'fields'];
  const lines = [header.join(',')];

  for (const r of view) {
    const row = [
      r.id,
      r.ts || '',
      r.level || '',
      (r.message || '').replaceAll('"', '""'),
      JSON.stringify(r.fields || {})
    ];
    lines.push(`${row[0]},${row[1]},${row[2]},"${row[3]}","${row[4].replaceAll('"', '""')}"`);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'logsieve.csv';
  a.click();
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

  // Export
  $("#exportJSON").addEventListener('click', exportJSON);
  $("#exportCSV").addEventListener('click', exportCSV);

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
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeEventHandlers);
} else {
  initializeEventHandlers();
}