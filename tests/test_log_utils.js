
// Tests for Log Parsing Utilities in shared.js

runTest('guessLevel', () => {
    assert.strictEqual(guessLevel('[INFO] System started'), 'INFO');
    assert.strictEqual(guessLevel('2023-01-01 10:00:00 ERROR: Connection failed'), 'ERROR');
    assert.strictEqual(guessLevel('WARN: Disk space low'), 'WARNING'); // Normalizes WARN to WARNING
    assert.strictEqual(guessLevel('Debug mode enabled'), 'DEBUG');
    assert.strictEqual(guessLevel('Just a plain message'), '');
});

runTest('tryTs (ISO-ish)', () => {
    const ts = tryTs('2023-11-19 12:34:56.789 [INFO] Message');
    // Check minutes and seconds which are usually stable across timezones (except weird ones)
    // and ensure it is a valid ISO string
    assert.ok(ts.includes(':34:56.789'), 'Should preserve minutes/seconds');
    assert.ok(!isNaN(new Date(ts).getTime()), 'Should be a valid date');
});

runTest('tryTs (Month Day)', () => {
    const ts = tryTs('Oct 28 11:11:15 server1 process[123]: message');
    assert.ok(ts.includes(':11:15'), 'Should preserve minutes/seconds');
    assert.ok(!isNaN(new Date(ts).getTime()), 'Should be a valid date');
});

runTest('stripPrefix', () => {
    assert.strictEqual(stripPrefix('2023-01-01 10:00:00 [INFO] Msg'), '[INFO] Msg');
    assert.strictEqual(stripPrefix('[2023-01-01 10:00:00] Msg'), 'Msg');
    assert.strictEqual(stripPrefix('Oct 28 11:11:15 Msg'), 'Msg');
});

runTest('isContinuationLine', () => {
    assert.strictEqual(isContinuationLine('2023-01-01 10:00:00 New Event'), false);
    assert.strictEqual(isContinuationLine('  at com.example.MyClass.method(MyClass.java:123)'), true);
    assert.strictEqual(isContinuationLine('    Indented line'), true);
    // Traceback should be true
    assert.strictEqual(isContinuationLine('Traceback (most recent call last):'), true);
    // Unindented exception is treated as a new event start
    assert.strictEqual(isContinuationLine('ValueError: invalid literal'), false);
});
