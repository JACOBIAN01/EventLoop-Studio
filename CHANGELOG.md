# Changelog

All notable changes to EventLoop Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-08-13

### Added

- **Node.js event loop mode.** A Browser/Node.js toggle in the header switches the entire
  visualization to model the real Node.js event loop instead of the browser's simplified one:
  all six libuv phases (Timers, Pending Callbacks, Idle/Prepare, Poll, Check, Close Callbacks),
  always in their real fixed order, drawn as a ring with a single "you are here" pointer and
  queue-depth badges.
  - The **Poll phase is genuinely real, not simulated**: it dispatches an actual `fs.readFile`
    to Node's real libuv thread pool and races multiple in-flight reads with `Promise.race`, so
    completion order reflects what the real thread pool actually did, not an order this tool
    decided in advance.
  - The **Check phase correctly keeps draining nested `setImmediate` calls** scheduled from
    inside another `setImmediate` callback in the same pass, matching real Node's own behavior
    (verified against real Node terminal output), rather than deferring them to the next loop
    iteration.
  - `process.nextTick` and the Promise/microtask queue are drawn once as a central **Microtask
    Hub** inside the ring, reflecting that they drain between every phase transition, not once
    per phase, a detail most explanations of this get wrong.
  - Actionable runtime error messages for common mistakes: using a Node-only API while in
    Browser mode now suggests switching modes; `require` explains why it's never exposed and
    points at the safe equivalents (`readFileReal`, `simulateSystemCallback`, `createHandle`).
- **Light/Dark theme.** A theme toggle next to the mode switch; the preference persists across
  reloads the same way the EventLoop Guide's on/off state does.
- **Resizable panels.** Every panel (Source, Console, Call Stack, Heap, Event Loop, Web APIs,
  Microtask/Macrotask Queue, and the whole Node-mode phase diagram as one block) can now be
  resized by dragging the divider between panels. Sizes persist across reloads; a "Reset
  Layout" button in the header restores every panel to its default size in one click.

### Fixed

- A trace shorter than the one currently being scrubbed (e.g. from switching Browser/Node.js
  mode, or re-recording after edits) no longer crashes the whole panel to a blank screen.
- Re-running "Visualize Event Loop" on an already-open panel (e.g. after editing the file) now
  preserves whichever mode the panel was already showing, instead of always resetting to
  Browser mode.

## [0.1.0] - 2026-08-10

### Changed

- License changed from MIT to a proprietary "All Rights Reserved" notice; the `package.json`
  license field is now `UNLICENSED`. Past versions distributed under MIT remain under those
  terms for whoever already received them.
- Added a **Creator** section to the README with author bio and portfolio link.

### Fixed

- Architecture diagrams in the README (recording pipeline, Visualize sequence, event loop
  decision flowchart) are now rendered as static images instead of Mermaid code blocks. The
  VS Code Marketplace's README renderer does not support Mermaid and was displaying the raw
  diagram syntax as plain text instead of a diagram.

## [0.0.1] - 2026-08-09

### Added

- **Visualize Event Loop** command: parses, instruments, and executes the active JavaScript
  file in a sandboxed VM, recording a full execution trace.
- Interactive replay UI with Call Stack, Heap, Web APIs, Microtask Queue, Macrotask Queue,
  Event Loop, Console, and synchronized source line highlighting.
- Playback controls: play/pause, step forward/backward, restart, speed control, and a
  timeline scrubber.
- Animated transitions (Framer Motion) for call stack pushes/pops and for tokens moving
  between the Web APIs / queues and the Call Stack.
- Two-tier **EventLoop Guide** narration: rule-level explanations that always stay visible,
  plus mechanical step-by-step narration that can be toggled off.
- Hoverable info tooltips on every core panel explaining the underlying concept.
- **Show Parsed AST (JSON)** command for inspecting the raw AST summary of a file.
- Live-updating Heap panel: variables and function parameters are re-snapshotted at every
  statement boundary and function exit, so reassignments are reflected, not just the value
  at declaration time.
- Explicit per-item timer lifecycle tracking (Web APIs → Macrotask Queue → Call Stack),
  eliminating the flicker that came from inferring timer state instead of tracking it directly.
- Extension and toolbar icons (light/dark variants).
- Sample scripts covering classic ordering, nested promises, async/await, recursion and
  closures, and more adversarial edge cases (shadowing, `this` binding, reference semantics).
