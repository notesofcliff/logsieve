
// Tests for Filtering Logic in shared.js

// Mock FieldRegistry if needed, but shared.js defines it.
// We need to ensure OPERATORS are available.

runTest('evaluateRule (Text)', () => {
    const row = { level: 'ERROR', message: 'Something went wrong' };

    assert.strictEqual(evaluateRule(row, { field: 'level', operator: 'equals', value: 'ERROR' }), true);
    assert.strictEqual(evaluateRule(row, { field: 'level', operator: 'equals', value: 'INFO' }), false);
    assert.strictEqual(evaluateRule(row, { field: 'message', operator: 'contains', value: 'wrong' }), true);
    assert.strictEqual(evaluateRule(row, { field: 'message', operator: 'startsWith', value: 'Some' }), true);
});

runTest('evaluateRule (Numeric)', () => {
    // We need to mock FieldRegistry to return 'numeric' type for a custom field
    // Or rely on auto-detection if implemented.
    // shared.js:468: const fieldType = fieldMeta?.type || (Array.isArray(fieldValue) ? 'array' : 'text');
    // It defaults to text if not in registry.
    // Let's register a numeric field first.
    FieldRegistry.register('latency', [100, 200]);

    const row = { fields: { latency: 150 } };

    // Note: OPERATORS.numeric must be defined in shared.js
    // Let's check if greaterThan works for numbers
    assert.strictEqual(evaluateRule(row, { field: 'latency', operator: 'greaterThan', value: '100' }), true);
    assert.strictEqual(evaluateRule(row, { field: 'latency', operator: 'lessThan', value: '100' }), false);
});

runTest('evaluateRule (Empty/NotEmpty)', () => {
    const row = { level: 'INFO', message: '' };
    assert.strictEqual(evaluateRule(row, { field: 'message', operator: 'empty' }), true);
    assert.strictEqual(evaluateRule(row, { field: 'level', operator: 'notEmpty' }), true);
    assert.strictEqual(evaluateRule(row, { field: 'missing_field', operator: 'empty' }), true);
});

runTest('evaluateRules (Logic)', () => {
    const row = { level: 'ERROR', app: 'backend' };
    // Mock app field
    row.fields = { app: 'backend' };

    const rulesAND = [
        { field: 'level', operator: 'equals', value: 'ERROR', logic: 'AND' },
        { field: 'app', operator: 'equals', value: 'backend', logic: null }
    ];
    assert.strictEqual(evaluateRules(row, rulesAND), true);

    const rulesOR = [
        { field: 'level', operator: 'equals', value: 'INFO', logic: 'OR' },
        { field: 'level', operator: 'equals', value: 'ERROR', logic: null }
    ];
    assert.strictEqual(evaluateRules(row, rulesOR), true);
});

runTest('evaluateAST (Advanced Query)', () => {
    const row = { level: 'ERROR', message: 'Connection timeout', fields: { latency: 500 } };
    FieldRegistry.register('latency', [500]);

    // AST for: level:ERROR AND latency>100
    const ast = {
        type: 'LOGIC', operator: 'AND',
        left: { type: 'RULE', field: 'level', operator: 'contains', value: 'ERROR' },
        right: { type: 'RULE', field: 'latency', operator: 'greaterThan', value: '100' }
    };

    assert.strictEqual(evaluateAST(row, ast), true);

    // AST for: level:INFO OR (latency>1000)
    const ast2 = {
        type: 'LOGIC', operator: 'OR',
        left: { type: 'RULE', field: 'level', operator: 'contains', value: 'INFO' },
        right: { type: 'RULE', field: 'latency', operator: 'greaterThan', value: '1000' }
    };
    assert.strictEqual(evaluateAST(row, ast2), false);
});
