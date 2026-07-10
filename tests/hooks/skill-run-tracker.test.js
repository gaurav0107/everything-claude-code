/**
 * Tests for scripts/hooks/skill-run-tracker.js
 *
 * The hook wires the write side of the skill-evolution JSONL tracker: it fires
 * on PostToolUse for the Skill tool and appends a record to
 * <home>/.claude/state/skill-runs.jsonl, which is what feeds
 * `scripts/skills-health.js --dashboard` (#2463).
 *
 * Run with: node tests/hooks/skill-run-tracker.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'skill-run-tracker.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-run-tracker-'));
}

// Spawn the hook with an isolated home dir so recordSkillExecution() writes to
// a throwaway skill-runs.jsonl instead of the real one. HOME covers POSIX,
// USERPROFILE covers Windows (both are what os.homedir() reads).
function runHook(homeDir, input) {
  return spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
}

function runsFilePath(homeDir) {
  return path.join(homeDir, '.claude', 'state', 'skill-runs.jsonl');
}

function readRecords(homeDir) {
  const file = runsFilePath(homeDir);
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

let passed = 0;
let failed = 0;

console.log('\nSkill Run Tracker Hook Tests');
console.log('============================\n');

if (test('records a run for a valid Skill PostToolUse payload (creates state dir)', () => {
  const home = createTempHome();
  try {
    const input = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill_id: 'superpowers:writing-plans', skill_version: '1.2.0', task_description: 'draft a plan' },
      tool_response: { output: 'ok' },
    });
    const result = runHook(home, input);
    assert.strictEqual(result.status, 0, `should exit 0, got ${result.status}`);
    const records = readRecords(home);
    assert.strictEqual(records.length, 1, `expected exactly one record, got ${records.length}`);
    assert.strictEqual(records[0].skill_id, 'superpowers:writing-plans');
    assert.strictEqual(records[0].skill_version, '1.2.0');
    assert.strictEqual(records[0].outcome, 'success');
    assert.ok(records[0].recorded_at, 'record should carry a recorded_at timestamp');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('derives skill_id from the "command" field and defaults version/description', () => {
  const home = createTempHome();
  try {
    const input = JSON.stringify({
      tool_name: 'Skill',
      tool_input: { command: 'code-review' },
    });
    const result = runHook(home, input);
    assert.strictEqual(result.status, 0);
    const records = readRecords(home);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].skill_id, 'code-review');
    assert.strictEqual(records[0].skill_version, 'unknown', 'version should fall back to "unknown"');
    assert.ok(records[0].task_description.includes('code-review'), 'task_description should be synthesized from the skill id');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('records outcome "failure" when the tool response is an error', () => {
  const home = createTempHome();
  try {
    const input = JSON.stringify({
      tool_name: 'Skill',
      tool_input: { skill_id: 'flaky-skill' },
      tool_response: { is_error: true, error: 'boom' },
    });
    const result = runHook(home, input);
    assert.strictEqual(result.status, 0);
    const records = readRecords(home);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].outcome, 'failure');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('records outcome "failure" on a PostToolUseFailure event', () => {
  const home = createTempHome();
  try {
    const input = JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Skill',
      tool_input: { skill_id: 'flaky-skill' },
    });
    const result = runHook(home, input);
    assert.strictEqual(result.status, 0);
    const records = readRecords(home);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].outcome, 'failure');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('ignores non-Skill tools and passes the payload through unchanged', () => {
  const home = createTempHome();
  try {
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'pwd' } });
    const result = runHook(home, input);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, input, 'stdout should echo the original payload');
    assert.strictEqual(readRecords(home).length, 0, 'no record should be written for a non-Skill tool');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('skips recording when no skill identifier can be resolved', () => {
  const home = createTempHome();
  try {
    const input = JSON.stringify({ tool_name: 'Skill', tool_input: {} });
    const result = runHook(home, input);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(readRecords(home).length, 0, 'no record without a skill id');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('never throws or blocks on malformed / empty stdin', () => {
  const home = createTempHome();
  try {
    for (const input of ['not valid json', '']) {
      const result = runHook(home, input);
      assert.strictEqual(result.status, 0, `should exit 0 for input ${JSON.stringify(input)}`);
      assert.strictEqual(result.stdout, input, 'stdout should echo the original input');
    }
    assert.strictEqual(readRecords(home).length, 0, 'no record should be written for malformed input');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
})) passed++; else failed++;

// deriveOutcome has four failure-detection paths on the tool response; cover
// the variants beyond the is_error boolean already exercised above.
const FAILURE_RESPONSE_VARIANTS = [
  ['tool_output alternative to tool_response', { tool_output: { is_error: true } }],
  ['isError camelCase variant', { tool_response: { isError: true } }],
  ['status string matching /error|fail/', { tool_response: { status: 'error' } }],
  ['non-empty error field', { tool_response: { error: 'kaboom' } }],
];

for (const [label, extra] of FAILURE_RESPONSE_VARIANTS) {
  if (test(`records outcome "failure" via ${label}`, () => {
    const home = createTempHome();
    try {
      const input = JSON.stringify({
        tool_name: 'Skill',
        tool_input: { skill_id: 'variant-skill' },
        ...extra,
      });
      const result = runHook(home, input);
      assert.strictEqual(result.status, 0);
      const records = readRecords(home);
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].outcome, 'failure');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  })) passed++; else failed++;
}

if (test('hooks.json registers post:skill:track on both PostToolUse and PostToolUseFailure', () => {
  const hooksJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8')
  );
  for (const event of ['PostToolUse', 'PostToolUseFailure']) {
    const entries = (hooksJson.hooks[event] || []).filter(
      e => e.id === 'post:skill:track' && e.matcher === 'Skill'
    );
    assert.strictEqual(entries.length, 1, `expected one Skill entry under ${event}`);
    assert.ok(
      entries[0].hooks[0].command.includes('scripts/hooks/skill-run-tracker.js'),
      `${event} entry should invoke skill-run-tracker.js`
    );
  }
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
