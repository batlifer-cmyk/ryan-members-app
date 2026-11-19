#!/usr/bin/env node
/**
 * Local unit test runner for the English Passport / Daily Talk Apps Script code.
 *
 * It loads the real Apps Script source files into a Node `vm` sandbox, so the
 * tests exercise the exact .gs code that gets pushed to Google. No Google API
 * is mocked away silently: functions that would touch Sheets or send messages
 * are never called from the pure-layer tests, and the storage layer is only
 * loaded for syntax/contract checks.
 *
 * Run: node tests/run-tests.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_FILES = ['PassportCore.gs', 'DailyTalkContentGenerator.gs', 'DailyTalkWixPublisher.gs']
  .map((name) => path.join(ROOT, 'apps-script', name));

const sandbox = {
  console,
  JSON,
  Math,
  Date,
  String,
  Number,
  Boolean,
  Array,
  Object,
  RegExp,
  Error,
  TypeError,
  isFinite,
  isNaN,
  parseInt,
  parseFloat,
  encodeURIComponent,
  decodeURIComponent
};
vm.createContext(sandbox);

SOURCE_FILES.forEach((file) => {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.relative(ROOT, file) });
});

// Expose every function declared in the Apps Script sources as a global for the tests.
Object.keys(sandbox).forEach((key) => {
  if (typeof sandbox[key] === 'function') global[key] = sandbox[key];
});
// Object.freeze'd constants are not functions.
global.RM_TRACKS = sandbox.RM_TRACKS;
global.RM_TRACK_LABELS = sandbox.RM_TRACK_LABELS;
global.RM_REGISTRATION_TYPES = sandbox.RM_REGISTRATION_TYPES;
global.RM_DAILY_TALK_STATUS = sandbox.RM_DAILY_TALK_STATUS;
global.RM_DAILY_TALK_GEN = sandbox.RM_DAILY_TALK_GEN;
global.RM_DAILY_TALK_CONFIG = sandbox.RM_DAILY_TALK_CONFIG;
global.RM_DAILY_TALK_TRACK_BRIEFS = sandbox.RM_DAILY_TALK_TRACK_BRIEFS;
global.ROOT = ROOT;
// Tests that need to fake a Google or Wix service install the stub on this
// sandbox object: functions defined in the .gs files read globals from it.
global.__sandbox = sandbox;

// --- tiny test framework ---------------------------------------------------
const state = { passed: 0, failed: 0, failures: [], current: null };

global.describe = (name, fn) => {
  const previous = state.current;
  state.current = previous ? `${previous} › ${name}` : name;
  try {
    fn();
  } finally {
    state.current = previous;
  }
};

global.test = (name, fn) => {
  const label = state.current ? `${state.current} › ${name}` : name;
  try {
    fn();
    state.passed += 1;
    process.stdout.write(`  ✓ ${label}\n`);
  } catch (error) {
    state.failed += 1;
    state.failures.push({ label, error });
    process.stdout.write(`  ✗ ${label}\n      ${error && error.message ? error.message : error}\n`);
  }
};

global.assert = {
  ok(value, message) {
    if (!value) throw new Error(message || `expected truthy, got ${JSON.stringify(value)}`);
  },
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  notEqual(actual, expected, message) {
    if (actual === expected) throw new Error(message || `expected value different from ${JSON.stringify(expected)}`);
  },
  deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(message || `expected ${b}, got ${a}`);
  },
  throws(fn, message) {
    let threw = false;
    try { fn(); } catch (error) { threw = true; }
    if (!threw) throw new Error(message || 'expected function to throw');
  },
  includes(haystack, needle, message) {
    if (String(haystack).indexOf(needle) === -1) {
      throw new Error(message || `expected to include ${JSON.stringify(needle)} in ${JSON.stringify(String(haystack).slice(0, 300))}`);
    }
  },
  excludes(haystack, needle, message) {
    if (String(haystack).indexOf(needle) !== -1) {
      throw new Error(message || `expected NOT to include ${JSON.stringify(needle)}`);
    }
  },
  match(text, regex, message) {
    if (!regex.test(String(text))) throw new Error(message || `expected ${JSON.stringify(String(text).slice(0, 200))} to match ${regex}`);
  }
};

// --- load test suites ------------------------------------------------------
const testDir = __dirname;
const suites = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

console.log(`\nPassport/Daily Talk unit tests (${suites.length} suites)\n`);
suites.forEach((file) => {
  console.log(`· ${file}`);
  require(path.join(testDir, file));
});

console.log(`\n${state.passed} passed, ${state.failed} failed\n`);
if (state.failed > 0) {
  state.failures.forEach((failure) => {
    console.error(`FAILED: ${failure.label}\n  ${failure.error && failure.error.stack ? failure.error.stack.split('\n').slice(0, 4).join('\n  ') : failure.error}`);
  });
  process.exit(1);
}
process.exit(0);
