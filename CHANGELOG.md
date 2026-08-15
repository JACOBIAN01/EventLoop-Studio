# Changelog

All notable changes to EventLoop Studio are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.3] - 2026-08-15

### Changed

- **Replaced the extension icon with a sharper 256x256 version.** The previous 128x128 PNG met
  VS Code's documented minimum but didn't have enough pixel density to render crisply on the
  Marketplace on any high-DPI display, where it was visibly blurry.

### Documentation

- Added Browser mode and Node.js mode demo GIFs to the README (stacked vertically), plus
  in-context screenshots throughout the Quick Start and Usage sections.
- Replaced the static, hand-typed version badge with a live Marketplace version/install-count
  badge, so it can no longer drift out of sync with the actual published version.
- Corrected the Installation section, which still claimed the extension "is not yet listed on the
  VS Code Marketplace" after it had already been published; Marketplace install is now listed as
  the primary option, `.vsix` install as the secondary one for a specific release build.
- Removed the portfolio link from the Creator section.

## [0.3.2] - 2026-08-15

### Added

- **The panel now auto-refreshes when you save the file you're visualizing.** Editing code no
  longer means closing and reopening the panel, or manually re-running the command; saving is
  enough. A save that fails to parse doesn't blank the panel: it keeps showing the last working
  trace and flags it with a small warning dot next to the filename, instead of wiping out
  whatever you were reviewing over an incidental typo.
- **An "Update" button in the Source panel** for previewing unsaved edits on demand, for when you
  want to see the effect of a change before committing to a save.
- **The ambiguous top-level `setTimeout(fn, 0)` vs. `setImmediate` race is now explained in the
  EventLoop Guide's own info tooltip**, not only in the Timers phase chip's hover tooltip. It's a
  permanent, always-findable caveat now, not something you only see if you happen to hover the
  right chip in Node mode.

### Changed

- **The Light/Dark toggle is now a single sun/moon button** instead of two separate text buttons.
- **The playback speed selector's active state now animates between speeds** instead of an
  instant color swap.
- **Node mode's default layout gives the phase-track ring enough width for all 6 phases to fit**
  without needing to scroll horizontally to see Poll, Check, or Close Callbacks.
- **The Close Callbacks -> Timers return path is now one connected line**, matching how the
  Poll -> Check and Check -> Close Callbacks jumps already looked, instead of 3 disconnected
  arrowheads.

### Fixed

- The EventLoop Studio panel's editor tab showed VS Code's generic default file icon instead of
  the extension's own icon, indistinguishable from any other open tab at a glance. The panel now
  reuses the same light/dark toolbar icon already shipped for its editor-title button.

## [0.3.1] - 2026-08-14

### Added

- **Registration calls now appear on the Call Stack.** `process.nextTick(...)`, `setTimeout(...)`,
  `setImmediate(...)`, `queueMicrotask(...)`, and `.then()`/`.catch()`/`.finally()` each get a
  brief real frame for the *registration call itself*, popping immediately, the same way
  `console.log` already did. Previously only `console.log` calls showed this; every other
  scheduling API silently skipped the stack, which was inconsistent with what's actually
  happening.
- **Pending callbacks show their real code, not the API that scheduled them.** Every queue token
  and phase-chip preview (Web APIs, nextTick Queue, Promise Queue, Macrotask Queue, and every
  Node-mode phase chip) now displays the callback's own source, truncated with a hoverable "i"
  icon that reveals the full, untruncated code alongside the API call that queued it. Two pending
  `process.nextTick` callbacks are now visually distinguishable from each other; before, both
  showed the identical generic label.
- **The Microtask Hub's nextTick/Promise split is now resizable**, joining every other panel
  split in the app, with its own entry in "Reset Layout."
- **Node mode's Pending Timers panel is now the ring's first phase chip**, not a separate panel
  connected by cross-container arrows. Pending Timers and the Timers phase were always the same
  underlying queue at two different moments (still waiting vs. ready to run); showing them as two
  disconnected things was misleading.
- **A top-level `setTimeout(fn, 0)` racing a top-level `setImmediate` is now flagged as
  ambiguous, not silently resolved as if it were a rule.** This is the one genuinely
  undocumented ordering in real Node itself: which one wins depends on real machine timing at
  process startup, not on any fixed rule (inside an I/O callback, `setImmediate` always and
  correctly wins, no ambiguity there). When this exact race occurs, the step's caption calls it
  out directly, and the Timers phase chip carries a dedicated hover tooltip explaining why a
  real terminal run can legitimately show the opposite order.

### Changed

- **FIFO queues (nextTick, Promise, Macrotask) always lay out horizontally now**, scrolling on
  the x-axis instead of wrapping to a second row, so left-to-right always reads as
  oldest-to-newest.
- **The Call Stack no longer shows a synthetic "... handler" frame.** Only the real callback
  function's own frame appears when it runs; the placeholder frame that used to precede it is
  gone.

### Fixed

- Tooltips inside the Call Stack, Heap, and Node mode's phase chips were being clipped by their
  panel's own scroll container; they now render correctly regardless of scroll position.
- The Source panel's active-line highlight bar no longer breaks when a long line is scrolled
  horizontally.
- Node mode's phase chip count badges were clipped in half at the panel's top edge; fixed with
  proper spacing.
- Removed a leftover "Hello Developer" command from the initial extension scaffold that had no
  purpose for anyone actually using the extension.

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
