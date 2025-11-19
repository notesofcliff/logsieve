
// Tests for Extractor Logic in shared.js

runTest('runSingleExtractor (Basic)', () => {
    const rows = [
        { raw: 'User: alice Action: login' },
        { raw: 'User: bob Action: logout' }
    ];
    // Define fieldNames set as it's expected by runSingleExtractor
    if (typeof fieldNames === 'undefined') global.fieldNames = new Set();

    const pattern = 'User: (?<user>\\w+) Action: (?<action>\\w+)';
    const hits = runSingleExtractor(pattern, rows);

    assert.strictEqual(hits, 2);
    assert.strictEqual(rows[0].fields.user[0], 'alice');
    assert.strictEqual(rows[0].fields.action[0], 'login');
    assert.strictEqual(rows[1].fields.user[0], 'bob');
});

runTest('runSingleExtractor (Merge Strategy: last-wins)', () => {
    const rows = [{ raw: 'key=val1 key=val2' }];
    const pattern = 'key=(?<key>\\w+)'; // Global flag is added inside function

    // runSingleExtractor uses 'g' flag so it finds all matches
    // But wait, runSingleExtractor implementation:
    // const matches = [...r.raw.matchAll(re)];
    // It collects all values into an array for the field.
    // So 'key' field will be ['val1', 'val2'].

    const hits = runSingleExtractor(pattern, rows);
    assert.strictEqual(hits, 1);
    assert.deepStrictEqual(rows[0].fields.key, ['val1', 'val2']);
});

runTest('runSingleExtractor (Invalid Regex)', () => {
    const rows = [{ raw: 'test' }];
    // Should not throw, returns 0
    const hits = runSingleExtractor('(?<invalid', rows);
    assert.strictEqual(hits, 0);
});
