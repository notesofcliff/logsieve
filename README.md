# LogSieve

A lightweight, client-side web application for exploring and filtering log files. LogSieve runs entirely in the browser with no backend required, making it perfect for offline log analysis.

## Links

🌐 **[Try LogSieve Online](https://notesofcliff.github.io/logsieve/)** - Use the hosted version  
📦 **[GitHub Repository](https://github.com/notesofcliff/logsieve)** - View source code  
💖 **[Support Development](https://github.com/sponsors/notesofcliff)** - Sponsor on GitHub

## Features

- **File drag-and-drop** - Load `.log`, `.txt`, `.json`, or `.ndjson` files instantly
- **Real-time filtering** - Search text, filter by log level, date range, and regex patterns
- **Field extraction** - Use named-group regex to extract structured data from logs
- **Extractor library** - Save and reuse regex patterns, apply multiple extractors at once
- **Saved filters** - Store filter presets for quick access to common queries
- **Import/export** - Share extractor libraries and filter configurations across devices
- **Visual summaries** - Get log level counts and timeline sparkline charts
- **Export capabilities** - Export filtered results as JSON or CSV
- **Completely offline** - No data leaves your machine, no server required

## Quick Start

1. Download or clone this repository
2. Open `index.html` in any modern web browser
3. Drag and drop a log file or use the "Browse" button
4. Start filtering and analyzing your logs

### Using Saved Extractors

1. Click **"+ New Extractor"** to create a regex pattern
2. Enter a name like "Apache Access Log" and pattern: `^(?<ip>\S+) .* "(?<method>\w+) (?<path>\S+)"`
3. Check the box to enable, then click **"▶ Run Active"**
4. Extracted fields appear as individual columns in the table (one column per field)
5. Each field can be sorted independently and exports cleanly to CSV

**Multiple Matches:** If your regex matches multiple times per line (e.g., `(?<num>\d+)` to extract all numbers), LogSieve captures all occurrences as an array. Single values display normally; arrays show as JSON.

To quickly try pre-configured patterns, click **"📥 Import Library"** and select `sample-extractors.json`.

### Saving Filters

1. Set up your filters (search text, log level, date range, etc.)
2. Click **"💾 Save Current Filter"**  
3. Enter a name like "Critical Errors" and save
4. Later, click the filter name to instantly reapply all settings

---

## Problem Statement

Traditional log analysis often involves switching between multiple command-line tools (`grep`, `awk`, `less`) which can be cumbersome for visual pattern recognition. LogSieve addresses the need for:

- **Offline operation** - No server dependencies
- **Zero setup** - Runs directly in the browser  
- **Visual analysis** - Charts and summaries beyond text output
- **Structured extraction** - Convert unstructured logs to structured data

---

## Architecture

LogSieve consists of three main files:

- **`index.html`** - Main HTML structure and UI elements
- **`logsieve.css`** - Styling and visual design
- **`logsieve.js`** - Core functionality and log processing logic

The application uses vanilla JavaScript with no external dependencies. Recent enhancements include:

- **Storage module**: localStorage management for extractors and filters
- **Multi-extractor logic**: Apply multiple patterns with configurable merge strategies  
- **UI management**: Modal dialogs, collapsible sections, library lists
- **Sample library**: `sample-extractors.json` with pre-configured common patterns

### Log Parsing

Files are processed entirely client-side using the FileReader API:

```js
const text = await readFileAsText(file);
rows = parseText(text);
```

The FileReader API loads the file content, which is then processed line-by-line. Each line gets automatic timestamp, level, and message detection using lightweight regular expressions:

```js
function tryTs(line) {
  const m = line.match(/(\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2})/);
  return m ? new Date(m[1]).toISOString() : '';
}

function guessLevel(line) {
  const up = line.toUpperCase();
  for (const lv of ['DEBUG','INFO','WARN','ERROR','CRITICAL'])
    if (up.includes(lv)) return lv === 'WARN' ? 'WARNING' : lv;
  return '';
}
```

After parsing, each log entry is structured as:

```js
{
  id: 42,
  ts: '2025-11-05T14:22:10.000Z',
  level: 'ERROR',
  message: 'Failed to connect to database',
  raw: '[2025-11-05 14:22:10] ERROR Failed to connect to database',
  fields: {}
}
```

### Filtering and Search

LogSieve uses in-memory filtering with a lowercase copy of each line for fast text search:

```js
if (q) {
  const terms = q.split(/\\s+/);
  v = v.filter(r => terms.every(t => r._lc.includes(t)));
}
```

Regex filters can be layered on top for advanced pattern matching. Since all processing is client-side, filtering provides instant feedback even with tens of thousands of lines.

Sorting is implemented efficiently with a simple comparison function:

```js
v.sort((a,b) => a[sort] < b[sort] ? -1 : 1);
```

#### Saved Filters

Save complete filter configurations for quick access to common queries:

```js
{
  name: "Critical Errors",
  query: "database",
  level: "ERROR",
  from: "2025-11-01T00:00",
  to: "2025-11-30T23:59",
  regex: "connection.*failed",
  sort: "ts",
  order: "desc"
}
```

Saved filters capture all active search parameters including text queries, log levels, date ranges, regex patterns, and sort order. Apply any saved filter with one click to instantly reproduce complex filter combinations. All filter presets are stored locally in the browser.

### Field Extraction

LogSieve supports **named-group regex extraction** for structured data parsing.

Provide a pattern like:

```
^\[(?<ts>[^]]+)\]\s(?<level>\w+)\s(?<message>.*)$
```

The extractor automatically populates captured groups as individual table columns. If your regex includes `ts`, `level`, or `message` groups, they'll replace the auto-detected values. Other named groups appear as sortable columns and export as separate CSV fields.

LogSieve uses `matchAll` to capture all occurrences of a pattern within each log line. For example, `(?<num>\d+)` extracts all numbers as an array `[1, 2, 3]` rather than just the first match. Single values display as plain text; multiple values display as JSON arrays.

This feature enables quick normalization of arbitrary log formats into structured, sortable, exportable data.

#### Extractor Library

Save frequently-used regex patterns to the **Extractor Library** for easy reuse:

- Create named extractors with descriptions
- Enable or disable individual extractors via checkboxes
- Apply multiple extractors simultaneously
- Edit and delete saved patterns
- Import/export extractor libraries to share with teammates

When multiple extractors match the same line, a configurable merge strategy determines how fields are combined (default: last-match-wins). Choose from:

- **Last Wins** - Later extractors override earlier captures
- **First Wins** - Keep first captured value, skip later ones  
- **Merge** - Combine all values (currently same as last-wins)

Configure the merge strategy in the Settings section. All extractors are stored in browser localStorage, keeping your data completely private.

A sample extractor library (`sample-extractors.json`) is included with common patterns for Apache logs, bracketed formats, user actions, IP addresses, and key-value pairs.

### Summary Statistics

LogSieve automatically computes summary statistics with each filter operation:

- Total row count
- Log level distribution  
- Timeline sparkline chart (rendered on HTML5 canvas)

```js
const buckets = new Map();
for (const r of view) {
  if (!r.ts) continue;
  const key = r.ts.slice(0,16); // minute bucket
  buckets.set(key, (buckets.get(key)||0) + 1);
}
drawSpark(canvas, [...buckets.values()]);
```

This provides a visual "heartbeat" of log activity over time.

### Storage Architecture

LogSieve uses browser localStorage to persist user preferences, saved extractors, and filter presets:

```javascript
localStorage keys:
- logsieve-extractors         // Saved regex patterns
- logsieve-filters             // Filter presets
- logsieve-active-extractors   // Currently enabled extractors
- logsieve-prefs               // User preferences
- logsieve-theme               // Theme preference
```

The storage layer is designed with a modular architecture that can be extended for cloud sync:

```javascript
const Storage = {
  local: { /* localStorage implementation */ },
  remote: { /* Future: API calls to backend */ },
  current: local  // Switch based on auth state
}
```

This architecture allows seamless transition between offline-only and cloud-synced modes without changing the core application logic.

## Deployment

LogSieve requires no build process or backend infrastructure:

1. Download the three files (`index.html`, `logsieve.css`, `logsieve.js`)
2. Host them on any web server (GitHub Pages, Netlify, etc.)
3. Or simply open `index.html` directly in a browser

All log processing happens client-side, so user data never leaves their machine.

## Development Roadmap

### Completed
- ✅ Persistent extractors in localStorage
- ✅ Saved filter presets
- ✅ Multi-extractor support
- ✅ Import/export library functionality

### Planned Enhancements
- Chunked parsing for 100MB+ logs (via Web Workers)
- Color-coding rule engine for log entries
- Additional export formats
- Cloud sync layer with Django backend
- User authentication and cross-device sync
- REST API for shared extractor libraries

## Browser Compatibility

LogSieve requires modern browser features:

- ES6+ JavaScript support
- localStorage API (for saving extractors and filters)
- FileReader API (for loading log files)
- CSS Grid and Flexbox (for responsive layout)

Tested on Chrome, Firefox, Edge, and Safari (latest versions).

## Contributing

LogSieve is designed to be simple and self-contained. Contributions should maintain the core principles of:

- No external dependencies
- Client-side only processing  
- Minimal setup requirements
- Privacy-focused (data never leaves the browser)

All new features are additive and maintain backwards compatibility with the original single-extractor functionality.

## License

This project is open source. Feel free to fork, modify, and distribute according to your needs.
