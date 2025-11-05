# LogSieve

A lightweight, client-side web application for exploring and filtering log files. LogSieve runs entirely in the browser with no backend required, making it perfect for offline log analysis.

## Features

- **File drag-and-drop** - Load `.log`, `.txt`, `.json`, or `.ndjson` files instantly
- **Real-time filtering** - Search text, filter by log level, date range, and regex patterns
- **Field extraction** - Use named-group regex to extract structured data from logs
- **Visual summaries** - Get log level counts and timeline sparkline charts
- **Export capabilities** - Export filtered results as JSON or CSV
- **Completely offline** - No data leaves your machine, no server required

## Quick Start

1. Download or clone this repository
2. Open `index.html` in any modern web browser
3. Drag and drop a log file or use the "Browse" button
4. Start filtering and analyzing your logs

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

The application totals approximately 900 lines of HTML, CSS, and vanilla JavaScript with no external dependencies.

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

### Field Extraction

LogSieve supports **named-group regex extraction** for structured data parsing.

Provide a pattern like:

```
^\[(?<ts>[^]]+)\]\s(?<level>\w+)\s(?<message>.*)$
```

The extractor automatically populates captured groups into the `fields` object for each matching row. If your regex includes `ts`, `level`, or `message` groups, they'll replace the auto-detected values.

This feature enables quick normalization of arbitrary log formats into structured data.

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

## Deployment

LogSieve requires no build process or backend infrastructure:

1. Download the three files (`index.html`, `logsieve.css`, `logsieve.js`)
2. Host them on any web server (GitHub Pages, Netlify, etc.)
3. Or simply open `index.html` directly in a browser

All log processing happens client-side, so user data never leaves their machine.

## Development Roadmap

Potential future enhancements include:

- Chunked parsing for 100MB+ logs (via Web Workers)
- Persistent extractors in localStorage
- Color-coding rule engine for log entries
- Additional export formats

## Contributing

LogSieve is designed to be simple and self-contained. Contributions should maintain the core principles of:

- No external dependencies
- Client-side only processing  
- Minimal setup requirements
- Privacy-focused (data never leaves the browser)

## License

This project is open source. Feel free to fork, modify, and distribute according to your needs.
