const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Configuration
const TEST_DIR = path.join(__dirname, 'tests');
const APP_FILES = ['shared.js']; // Files to load into the test context

// Colors for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function loadAppCode() {
    const context = vm.createContext({
        console: console,
        // Mock browser globals if needed
        window: {},
        navigator: {},
        global: {}, // Add global for tests that use it
        generateUUID: () => 'mock-uuid-' + Math.random().toString(36).substr(2, 9),
        fmt: (n) => n,
    });

    for (const file of APP_FILES) {
        const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
        try {
            vm.runInContext(code, context, { filename: file });
        } catch (e) {
            console.error(`${RED}Error loading ${file}:${RESET}`, e);
            process.exit(1);
        }
    }
    return context;
}

function runTests() {
    if (!fs.existsSync(TEST_DIR)) {
        console.error(`Test directory ${TEST_DIR} not found.`);
        process.exit(1);
    }

    const testFiles = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.js'));
    let totalPassed = 0;
    let totalFailed = 0;

    console.log(`${BOLD}Running ${testFiles.length} test files...${RESET}\n`);

    for (const file of testFiles) {
        console.log(`📄 ${BOLD}${file}${RESET}`);
        const context = loadAppCode();

        // Add test helpers to context
        context.assert = require('assert');
        context.testResults = { passed: 0, failed: 0 };
        context.runTest = (name, fn) => {
            try {
                fn();
                console.log(`  ${GREEN}✓${RESET} ${name}`);
                context.testResults.passed++;
            } catch (e) {
                console.error(`  ${RED}✗${RESET} ${name}`);
                console.error(`    ${e.message}`);
                context.testResults.failed++;
            }
        };

        const testCode = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
        try {
            vm.runInContext(testCode, context, { filename: file });
            totalPassed += context.testResults.passed;
            totalFailed += context.testResults.failed;
        } catch (e) {
            console.error(`${RED}Error running ${file}:${RESET}`, e);
            totalFailed++;
        }
        console.log(''); // Newline
    }

    console.log(`${BOLD}Summary:${RESET}`);
    console.log(`${GREEN}${totalPassed} passed${RESET}`);
    if (totalFailed > 0) {
        console.log(`${RED}${totalFailed} failed${RESET}`);
        process.exit(1);
    } else {
        console.log('All tests passed! 🎉');
    }
}

runTests();
