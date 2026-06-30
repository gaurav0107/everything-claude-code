'use strict';

// Regression test for #2316: plan-orchestrate must detect the renamed
// `ecc@ecc` marketplace install (`<claude-home>/plugins/marketplaces/ecc/`)
// and emit the canonical `ecc:` command/agent namespace, while keeping
// backward compatibility with the pre-2.0.0 `everything-claude-code`
// marketplace and the legacy bare install.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'plan-orchestrate', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

console.log('\n=== Testing plan-orchestrate install detection (#2316) ===\n');

test('detects the canonical ecc@ecc marketplace install path', () => {
  assert.ok(
    skill.includes('marketplaces/ecc/'),
    'Expected Phase 0 detection to recognize <claude-home>/plugins/marketplaces/ecc/ (the ecc@ecc 2.0.0+ install path)'
  );
});

test('emits the canonical /ecc:orchestrate plugin command', () => {
  assert.ok(
    skill.includes('/ecc:orchestrate'),
    'Expected the canonical short plugin command namespace /ecc:orchestrate'
  );
});

test('emits the canonical ecc: agent namespace', () => {
  assert.ok(
    skill.includes('ecc:<name>') || skill.includes('ecc:tdd-guide'),
    'Expected agent names rendered under the canonical ecc: plugin namespace'
  );
});

test('keeps backward-compat detection for the pre-2.0.0 marketplace id', () => {
  assert.ok(
    skill.includes('marketplaces/everything-claude-code/'),
    'Expected detection to still recognize the pre-rename everything-claude-code marketplace path'
  );
});

test('prefers the ecc marketplace over the legacy id (ordering)', () => {
  const eccIdx = skill.indexOf('marketplaces/ecc/');
  const legacyIdx = skill.indexOf('marketplaces/everything-claude-code/');
  assert.ok(eccIdx !== -1 && legacyIdx !== -1, 'Expected both marketplace paths to be documented');
  assert.ok(
    eccIdx < legacyIdx,
    'Expected the canonical ecc marketplace to be matched before the legacy everything-claude-code marketplace'
  );
});

test('the Phase 0 detection algorithm itself checks ecc before the legacy marketplace', () => {
  // Scope the ordering assertion to the actual detection algorithm so a
  // future edit cannot regress the algorithm order while the table/examples
  // keep the whole-document check above green.
  const start = skill.indexOf('Detect ECC install form once and freeze');
  assert.ok(start !== -1, 'Expected the Phase 0 detection algorithm block to be present');
  const after = skill.indexOf('From this point on', start);
  const algo = skill.slice(start, after === -1 ? undefined : after);
  const eccIdx = algo.indexOf('marketplaces/ecc/');
  const legacyIdx = algo.indexOf('marketplaces/everything-claude-code/');
  assert.ok(
    eccIdx !== -1 && legacyIdx !== -1,
    'Expected the detection algorithm to check both marketplace paths'
  );
  assert.ok(
    eccIdx < legacyIdx,
    'Expected the detection algorithm to match marketplaces/ecc/ before marketplaces/everything-claude-code/'
  );
});

test('plan-declared agent normalization strips either known plugin prefix', () => {
  assert.ok(
    skill.includes('ecc:tdd-guide') &&
      skill.includes('everything-claude-code:tdd-guide') &&
      skill.includes('strip any known plugin prefix'),
    'Expected Phase 0 step 5 to normalize both ecc: and everything-claude-code: prefixes before catalogue validation'
  );
});

test('still documents the legacy bare install and its fallback warning', () => {
  assert.ok(
    skill.includes('Legacy bare install'),
    'Expected the legacy bare install form to remain documented'
  );
  assert.ok(
    skill.includes('could not detect ECC install'),
    'Expected the legacy-fallback warning to remain documented'
  );
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
