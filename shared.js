/**
 * LogSieve - Shared Utilities and Logic
 * Used by both the main UI thread and the Web Worker
 */

// ---------- Utilities ----------

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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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

/**
 * Tokenize string for search purposes
 * @param {string} s - String to tokenize
 * @returns {Array<string>} - Array of tokens
 */
function tokenize(s) {
    return s.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}

// ---------- Log Parsing Helpers ----------

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
        {
            value: 'before', label: 'before', fn: (a, b) => {
                const aa = parseTimestampToISO(a) || a;
                const bb = parseTimestampToISO(b) || b;
                const da = new Date(aa);
                const db = new Date(bb);
                if (isNaN(da) || isNaN(db)) return false;
                return da < db;
            }
        },
        {
            value: 'after', label: 'after', fn: (a, b) => {
                const aa = parseTimestampToISO(a) || a;
                const bb = parseTimestampToISO(b) || b;
                const da = new Date(aa);
                const db = new Date(bb);
                if (isNaN(da) || isNaN(db)) return false;
                return da > db;
            }
        },
        {
            value: 'between', label: 'between', fn: (a, b) => {
                const aa = parseTimestampToISO(a) || a;
                const date = new Date(aa);
                const parts = (b || '').split(',');
                if (parts.length < 2) return false;
                const start = new Date(parseTimestampToISO(parts[0]) || parts[0]);
                const end = new Date(parseTimestampToISO(parts[1]) || parts[1]);
                if (isNaN(date) || isNaN(start) || isNaN(end)) return false;
                return date >= start && date <= end;
            }
        },
        {
            value: 'equals', label: 'on', fn: (a, b) => {
                const aa = parseTimestampToISO(a) || a;
                const bb = parseTimestampToISO(b) || b;
                const da = new Date(aa);
                const db = new Date(bb);
                if (isNaN(da) || isNaN(db)) return false;
                return da.toISOString().split('T')[0] === db.toISOString().split('T')[0];
            }
        }
    ],
    array: [
        { value: 'contains', label: 'contains', fn: (arr, val) => Array.isArray(arr) && arr.some(v => String(v).toLowerCase().includes(String(val).toLowerCase())) },
        {
            value: 'containsAll', label: 'contains all', fn: (arr, val) => {
                const values = String(val).split(',').map(v => v.trim());
                return values.every(v => Array.isArray(arr) && arr.some(av => String(av).toLowerCase().includes(v.toLowerCase())));
            }
        },
        {
            value: 'containsAny', label: 'contains any', fn: (arr, val) => {
                const values = String(val).split(',').map(v => v.trim());
                return values.some(v => Array.isArray(arr) && arr.some(av => String(av).toLowerCase().includes(v.toLowerCase())));
            }
        },
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
    },
    serialize() {
        return Array.from(this.fields.entries()).map(([key, val]) => ({
            key,
            val: {
                ...val,
                uniqueValues: Array.from(val.uniqueValues)
            }
        }));
    },
    deserialize(data) {
        this.fields.clear();
        if (!data) return;
        data.forEach(item => {
            const val = item.val;
            val.uniqueValues = new Set(val.uniqueValues);
            this.fields.set(item.key, val);
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
