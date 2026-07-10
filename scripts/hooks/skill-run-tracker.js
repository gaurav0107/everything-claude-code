#!/usr/bin/env node
'use strict';

/**
 * PostToolUse Hook: record Skill tool invocations for skill-health telemetry.
 *
 * Wires the write side of the already-shipped JSONL tracker
 * (scripts/lib/skill-evolution/tracker.js). Before this hook,
 * recordSkillExecution() had zero production callers, so
 * ~/.claude/state/skill-runs.jsonl was never written and
 * `scripts/skills-health.js --dashboard` always reported 0 runs (#2463).
 *
 * Fires after every Skill tool call. Best-effort: extracts skill_id /
 * skill_version / task_description / outcome from the PostToolUse payload and
 * appends one record. Never blocks tool execution — it always passes the
 * payload through and exits 0, even on parse or record failure.
 *
 * Cross-platform (Windows, macOS, Linux); CommonJS.
 */

const { recordSkillExecution } = require('../lib/skill-evolution/tracker');

const MAX_STDIN = 1024 * 1024; // 1MB

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

// Extract the skill identifier from the Skill tool input across the field
// names Claude Code has used for it. The Skill tool is genuinely un-wired in
// this repo, so no single canonical field is guaranteed — probe the plausible
// ones and bail (record nothing) if none is present.
function extractSkillId(toolInput) {
  if (typeof toolInput === 'string') {
    return firstNonEmptyString(toolInput);
  }
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }
  return firstNonEmptyString(
    toolInput.skill_id,
    toolInput.skillId,
    toolInput.skill,
    toolInput.name,
    toolInput.command
  );
}

// Best-effort outcome: a failed tool call is recorded as "failure", everything
// else as "success". Both PostToolUseFailure routing and an error-bearing
// tool response are treated as failure.
function deriveOutcome(payload) {
  if (payload && payload.hook_event_name === 'PostToolUseFailure') {
    return 'failure';
  }

  const response = (payload && (payload.tool_response ?? payload.tool_output)) || null;
  if (response && typeof response === 'object') {
    if (response.is_error === true || response.isError === true) {
      return 'failure';
    }
    if (typeof response.status === 'string' && /error|fail/i.test(response.status)) {
      return 'failure';
    }
    if (firstNonEmptyString(response.error)) {
      return 'failure';
    }
  }

  return 'success';
}

function buildRecord(payload) {
  const skillId = extractSkillId(payload.tool_input);
  if (!skillId) {
    return null; // cannot satisfy the tracker's required skill_id — skip
  }

  const input = payload.tool_input && typeof payload.tool_input === 'object'
    ? payload.tool_input
    : {};

  const skillVersion = firstNonEmptyString(
    input.skill_version,
    input.skillVersion,
    input.version
  ) || 'unknown';

  const taskDescription = firstNonEmptyString(
    input.task_description,
    input.taskDescription,
    input.description,
    input.prompt
  ) || `Skill invocation: ${skillId}`;

  return {
    skill_id: skillId,
    skill_version: skillVersion,
    task_description: taskDescription,
    outcome: deriveOutcome(payload),
  };
}

function passthrough(rawInput) {
  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

function run(rawInput) {
  try {
    const payload = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    if (payload && typeof payload === 'object' && payload.tool_name === 'Skill') {
      const record = buildRecord(payload);
      if (record) {
        recordSkillExecution(record);
      }
    }
  } catch (error) {
    // Telemetry is best-effort; never block tool execution on a failure here.
    process.stderr.write(`[SkillRunTracker] ${error.message}\n`);
  }

  return passthrough(rawInput);
}

// Write stdout fully before exiting. Calling process.exit() immediately after
// process.stdout.write() can drop anything beyond the OS pipe buffer (~64KB),
// cutting a large pass-through payload mid-JSON — the #2222 pattern that
// run-with-flags.js guards against via exitWithStdout. The write callback fires
// only after the chunk is flushed. Production goes through run-with-flags.js
// (which flushes properly); this guards the direct-CLI and test paths.
function exitWithStdout(text, exitCode) {
  const out = typeof text === 'string' ? text : String(text ?? '');
  if (out.length === 0) {
    process.exit(exitCode);
    return;
  }
  process.stdout.write(out, () => process.exit(exitCode));
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      raw += chunk.substring(0, MAX_STDIN - raw.length);
    }
  });
  process.stdin.on('end', () => exitWithStdout(run(raw), 0));
  process.stdin.on('error', () => exitWithStdout(raw, 0));
}

module.exports = { run };
