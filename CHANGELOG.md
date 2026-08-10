# Changelog

All notable changes to EventLoop Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
