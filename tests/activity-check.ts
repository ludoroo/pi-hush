import assert from "node:assert/strict";
import {
  HushActivityTracker,
  sanitizeHushToolName,
} from "../extensions/hush/lib/activity.ts";

assert.equal(sanitizeHushToolName(" read\n\tfiles "), "read files");
assert.equal(sanitizeHushToolName("\x1b[31mread\x1b[0m"), "read");
assert.equal(sanitizeHushToolName("\x1b]0;bad title\x07bash"), "bash");
assert.equal(
  sanitizeHushToolName("\x1b]8;;https://example.com\x1b\\read\x1b]8;;\x1b\\"),
  "read",
);
assert.equal(sanitizeHushToolName("\x1b]unterminated"), "tool");
assert.equal(sanitizeHushToolName("\u061c\u202eread\u2066"), "read");
assert.equal(sanitizeHushToolName("\n\t\x00"), "tool");
assert.equal(sanitizeHushToolName("x".repeat(100)).length, 80);

const activity = new HushActivityTracker();
assert.equal(activity.text, undefined);
activity.startTurn();
activity.updateAssistant("thinking_delta");
activity.startTool("orphan", "bash");
assert.equal(activity.text, undefined);

// Busy does not imply reasoning. Models without thinking events stay Working.
activity.startRun();
assert.equal(activity.text, "Working");
activity.updateAssistant("start");
assert.equal(activity.text, "Working");
activity.updateAssistant("unknown_future_event");
assert.equal(activity.text, "Working");

// Only explicit thinking events identify thinking, including a block with no deltas.
activity.updateAssistant("thinking_start");
assert.equal(activity.text, "Thinking");
activity.updateAssistant("thinking_end");
assert.equal(activity.text, "Working");
activity.updateAssistant("thinking_delta");
assert.equal(activity.text, "Thinking");
activity.startTurn();
assert.equal(activity.text, "Working");

activity.updateAssistant("text_start");
assert.equal(activity.text, "Responding");
activity.updateAssistant("text_delta");
assert.equal(activity.text, "Responding");
activity.updateAssistant("text_end");
assert.equal(activity.text, "Working");

// Finishing another block type must not overwrite the current stream phase.
activity.updateAssistant("text_start");
activity.updateAssistant("thinking_end");
assert.equal(activity.text, "Responding");
activity.updateAssistant("thinking_start");
activity.updateAssistant("text_end");
assert.equal(activity.text, "Thinking");

// Preparing tool arguments and terminal stream events are work, not thinking.
for (const event of ["toolcall_start", "toolcall_delta", "toolcall_end", "start", "done", "error"]) {
  activity.updateAssistant("thinking_delta");
  activity.updateAssistant(event);
  assert.equal(activity.text, "Working", event);
}

// Tool execution retains its deterministic parallel summary and takes precedence.
activity.startTool("read-1", "read");
assert.equal(activity.text, "Running read");
activity.startTool("bash-1", "bash");
activity.startTool("grep-1", "grep");
assert.equal(activity.text, "Running read +2");
activity.startTool("read-1", "ignored duplicate");
activity.endTool("unknown");
assert.equal(activity.text, "Running read +2");
activity.endTool("bash-1");
assert.equal(activity.text, "Running read +1");
activity.endTool("read-1");
assert.equal(activity.text, "Running grep");
activity.endTool("grep-1");
assert.equal(activity.text, "Working");

// If streaming overlaps tool execution, finishing a tool must not erase it.
for (const [event, label] of [
  ["thinking_delta", "Thinking"],
  ["text_delta", "Responding"],
] as const) {
  activity.startTool("parallel", "read");
  activity.updateAssistant(event);
  assert.equal(activity.text, "Running read");
  activity.endTool("parallel");
  assert.equal(activity.text, label);
  activity.endTool("late-unknown");
  assert.equal(activity.text, label);
  activity.updateAssistant("done");
  assert.equal(activity.text, "Working");
}

activity.startTool("still-running", "bash");
activity.updateAssistant("done");
assert.equal(activity.text, "Running bash");
activity.endRun();
assert.equal(activity.text, "Working");
activity.startTool("stale", "bash");
activity.startRun();
assert.equal(activity.text, "Working");
activity.reset();
activity.updateAssistant("thinking_delta");
activity.endRun();
assert.equal(activity.text, undefined);

console.log("activity checks passed");
