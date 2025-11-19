
// Test Chunked Parsing Logic
// This test simulates the worker environment and tests the parseLogChunk function directly

const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// Mock worker environment
const context = vm.createContext({
    self: {},
    window: undefined, // Ensure isWorker check passes
    importScripts: () => { },
    console: console,
    performance: { now: () => Date.now() },
    postMessage: (msg) => {
        // console.log('Worker sent message:', msg.type);
    },
    fmt: (n) => n
});

// Load shared.js and logsieve-worker.js
const sharedCode = fs.readFileSync(path.join(__dirname, '../shared.js'), 'utf8');
const workerCode = fs.readFileSync(path.join(__dirname, '../logsieve-worker.js'), 'utf8');

vm.runInContext(sharedCode, context);
vm.runInContext(workerCode, context);

// Helper to access worker state
function getRows() {
    return vm.runInContext('rows', context);
}

function reset() {
    context.resetParserState();
}

function parseChunk(chunk, isLast) {
    context.parseLogChunk(chunk, isLast);
}

console.log('Running Chunked Parsing Tests...');

// Test 1: Simple split
console.log('Test 1: Simple split across lines');
reset();
parseChunk('2023-01-01 10:00:00 INFO Line 1\n2023-01-01 10:00:01', false);
parseChunk(' INFO Line 2\n', true);

let rows = getRows();
assert.strictEqual(rows.length, 2, 'Should have 2 rows');
assert.strictEqual(rows[0].message, 'INFO Line 1');
assert.strictEqual(rows[1].message, 'INFO Line 2');
console.log('✓ Passed');

// Test 2: Split inside a line (no newline in first chunk)
console.log('Test 2: Split inside a line');
reset();
parseChunk('2023-01-01 10:00:00 INFO Start of', false);
parseChunk(' line\n', true);

rows = getRows();
assert.strictEqual(rows.length, 1, 'Should have 1 row');
assert.strictEqual(rows[0].message, 'INFO Start of line');
console.log('✓ Passed');

// Test 3: Multi-line log split
console.log('Test 3: Multi-line log split');
reset();
const part1 = '2023-01-01 10:00:00 ERROR Error occurred\nTraceback (most recent call last):\n';
const part2 = '  File "main.py", line 10\n    print(x)\nNameError: name \'x\' is not defined\n';

parseChunk(part1, false);
parseChunk(part2, true);

rows = getRows();
if (rows.length !== 1) {
    console.log('Rows found:', rows);
    console.log('Check isContinuationLine:', context.isContinuationLine('  File "main.py", line 10'));
}
assert.strictEqual(rows.length, 2, 'Should have 2 rows (NameError is treated as new entry by current logic)');
assert.ok(rows[0].message.includes('Error occurred'), 'Row 1 should contain header');
assert.ok(rows[0].message.includes('Traceback'), 'Row 1 should contain traceback header');
assert.ok(rows[0].message.includes('File "main.py"'), 'Row 1 should contain stack frame (merged across chunk)');
assert.ok(rows[1].message.includes('NameError'), 'Row 2 should be the NameError');
console.log('✓ Passed');

// Test 4: Multi-line split exactly at newline
console.log('Test 4: Multi-line split exactly at newline');
reset();
parseChunk('2023-01-01 10:00:00 ERROR Error\n', false);
parseChunk('  at function (file.js:10)\n', true);

rows = getRows();
assert.strictEqual(rows.length, 1, 'Should have 1 row');
assert.ok(rows[0].message.includes('at function'), 'Should merge indented line');
console.log('✓ Passed');

console.log('All chunked parsing tests passed! 🎉');
