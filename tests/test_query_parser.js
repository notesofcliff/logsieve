
// Tests for QueryParser class in shared.js

runTest('Simple field equality', () => {
    const parser = new QueryParser('level:ERROR');
    const ast = parser.parse();
    assert.strictEqual(ast.type, 'RULE');
    assert.strictEqual(ast.field, 'level');
    assert.strictEqual(ast.operator, 'contains'); // Defaults to contains
    assert.strictEqual(ast.value, 'ERROR');
});

runTest('Implicit AND', () => {
    const parser = new QueryParser('level:ERROR app:main');
    const ast = parser.parse();
    assert.strictEqual(ast.type, 'LOGIC');
    assert.strictEqual(ast.operator, 'AND');
    assert.strictEqual(ast.left.field, 'level');
    assert.strictEqual(ast.right.field, 'app');
});

runTest('Explicit OR', () => {
    const parser = new QueryParser('level:ERROR OR level:WARN');
    const ast = parser.parse();
    assert.strictEqual(ast.type, 'LOGIC');
    assert.strictEqual(ast.operator, 'OR');
});

runTest('Grouping with Parentheses', () => {
    const parser = new QueryParser('(level:ERROR OR level:WARN) AND app:main');
    const ast = parser.parse();
    assert.strictEqual(ast.type, 'LOGIC');
    assert.strictEqual(ast.operator, 'AND');
    assert.strictEqual(ast.left.type, 'LOGIC');
    assert.strictEqual(ast.left.operator, 'OR');
    assert.strictEqual(ast.right.field, 'app');
});

runTest('NOT Operator', () => {
    const parser = new QueryParser('NOT level:INFO');
    const ast = parser.parse();
    assert.strictEqual(ast.type, 'NOT');
    assert.strictEqual(ast.operand.field, 'level');
    assert.strictEqual(ast.operand.value, 'INFO');
});

runTest('Wildcards', () => {
    const p1 = new QueryParser('user:admin*');
    const ast1 = p1.parse();
    assert.strictEqual(ast1.operator, 'matches');
    assert.strictEqual(ast1.value, '^admin.*$');

    const p2 = new QueryParser('user:*admin');
    const ast2 = p2.parse();
    assert.strictEqual(ast2.operator, 'matches');
    assert.strictEqual(ast2.value, '^.*admin$');
});

runTest('Comparisons', () => {
    const parser = new QueryParser('latency>100');
    const ast = parser.parse();
    assert.strictEqual(ast.operator, 'greaterThan');
    assert.strictEqual(ast.value, '100');
});
