<div align="center">

# EventLoop Studio

**Watch your own JavaScript actually run: call stack, heap, timers, microtasks, and the event loop, one step at a time.**

</div>

---

## Table of Contents

- [Overview](#overview)
- [Why This Project Is Different](#why-this-project-is-different)
- [Feature Tour](#feature-tour)
  - [Visualize Event Loop command](#visualize-event-loop-command)
  - [Call Stack](#call-stack)
  - [Heap](#heap)
  - [Web APIs](#web-apis)
  - [Microtask Queue \& Macrotask Queue](#microtask-queue--macrotask-queue)
  - [Event Loop panel](#event-loop-panel)
  - [Console](#console)
  - [Source line sync](#source-line-sync)
  - [Playback controls](#playback-controls)
  - [EventLoop Guide (narration)](#eventloop-guide-narration)
  - [Info tooltips](#info-tooltips)
  - [Show Parsed AST (JSON)](#show-parsed-ast-json)
- [How It Works: Internal Architecture](#how-it-works-internal-architecture)
  - [The recording pipeline](#the-recording-pipeline)
  - [Sequence: what happens when you click Visualize](#sequence-what-happens-when-you-click-visualize)
  - [The event loop's actual decision procedure](#the-event-loops-actual-decision-procedure)
- [Project Structure](#project-structure)
- [Technical Decisions \& Design Rationale](#technical-decisions--design-rationale)
- [Known Simplifications](#known-simplifications)
- [User Journey](#user-journey)
- [Sample Scripts](#sample-scripts)
- [Educational Value](#educational-value)
- [Roadmap](#roadmap)
- [Publishing Checklist](#publishing-checklist)

---

## Overview

**EventLoop Studio** is a VS Code extension that answers a question almost every JavaScript developer has asked at some point, usually while debugging something confusing: *"wait, why did that run in that order?"*

Point it at a `.js` file and click **Visualize Event Loop**. It doesn't animate a canned example. It actually **runs your code** in a sandboxed environment, records every meaningful thing the JavaScript runtime does (function calls, timer registrations, promise scheduling, console output), and replays that recording as an interactive, step-by-step diagram synchronized with your source code.

You get to see, frame by frame:

- Functions pushed onto and popped off the **Call Stack**
- Variables and their values living in the **Heap**, updating as your code mutates them
- `setTimeout` callbacks waiting in **Web APIs**, then moving to the **Macrotask Queue** once their delay elapses
- `.then()`/`async` continuations queuing up in the **Microtask Queue**
- The **Event Loop** itself deciding, at every step, what runs next, and why

This isn't a static diagram or a pre-recorded animation. It's *your* code, actually executing.

---

## Why This Project Is Different

Most event-loop explainers fall into one of two camps:

| Approach | Limitation |
|---|---|
| Articles / diagrams | Static: shows one fixed example, can't answer "what about *my* code?" |
| Generic browser visualizers | Usually re-simulate JS semantics from scratch, which quietly breaks on recursion, closures, or real `async`/`await`, or only works on code you paste into a separate website |

EventLoop Studio takes a different approach on both fronts:

> [!NOTE]
> **It doesn't guess at JavaScript semantics: it runs your code for real**, inside a sandboxed Node `vm` context, and *records* what actually happened. Recursion, closures, real `async`/`await`, nested promises, and edge cases like variable shadowing all behave correctly, because they're not being reverse-engineered from an AST; the real V8 engine is doing the work. Static AST simulation was considered and rejected early on for exactly this reason: it cannot correctly handle arbitrary control flow.

It also lives **directly in your editor**, working on the file you already have open, no copy-pasting into a separate website, no disconnect between "the code" and "the visualization."

A few other things that set it apart:

- **The Heap panel is live, not a one-time snapshot.** Early versions of this tool only captured a variable's value at the moment it was declared. It now re-snapshots every tracked variable and function parameter at every statement boundary and function exit, so reassignments (`x++`, `x += await …`) show up correctly, not just the initial value.
- **The Web APIs → Macrotask Queue → Call Stack lifecycle is real, not inferred.** Timer state is tracked as an explicit per-item fact (driven by dedicated recorder events), not guessed from whatever else happens to be on the call stack at a given instant; that's what used to cause timers to flicker between panels.
- **The narration explains the rule, not just the action**, and it doesn't get old. See [EventLoop Guide](#eventloop-guide-narration) below.

---

## Feature Tour

### Visualize Event Loop command

The main entry point. Available from the Command Palette or as a toolbar button in the editor title bar (only shown for `.js` files). Running it:

1. Reads the currently active JavaScript file
2. Parses and instruments it
3. Executes it in a sandbox, recording every step
4. Opens a webview panel replaying the result

**Use case:** you're debugging a race condition, or you're a student trying to understand why `console.log` order doesn't match source-code order. Instead of adding a dozen `console.log` calls and guessing, you watch it happen.

### Call Stack

Renders active function frames bottom-to-top, newest on top, exactly like a real call stack. Recursive calls stack visibly, one frame per invocation. The top frame is visually distinct (solid fill) so you can immediately see what's *currently* executing versus what's merely still on the stack waiting for something it called to return.

### Heap

Shows every tracked `let`/`const`/`var` binding and function parameter, with its **current** value: live-updated as your code mutates it, not frozen at declaration time.

**Use case:** watching a closure's captured variable change across multiple invocations, or seeing exactly when a shared variable gets mutated by an async callback versus the main script.

> [!TIP]
> Because the Heap is a flat, name-keyed view, a variable that's *shadowed* (e.g. an inner `let x` inside a function that also has an outer `x` in scope) will show whichever one was most recently touched, not both side-by-side. See [Known Simplifications](#known-simplifications).

### Web APIs

Timers (`setTimeout`) live here the moment they're registered. This is the panel that represents "handed off outside the JS engine, counting down in the background, not blocking anything."

### Microtask Queue & Macrotask Queue

This is where the classic "why did my 0ms timeout run *after* my promise?" question gets answered visually:

- `.then()` / `async` continuations go straight into the **Microtask Queue**.
- A `setTimeout` callback, once its delay elapses, moves from **Web APIs** into the **Macrotask Queue**, and waits there.
- The **Event Loop** always fully drains the Microtask Queue before it ever looks at the Macrotask Queue, and it only pulls a macrotask once the Call Stack is completely empty.

Each pending item visually travels from the queue it's sitting in directly into the Call Stack the moment it actually runs: a genuine shared-element animation (via Framer Motion), not two unrelated fade transitions that happen to occur near each other.

### Event Loop panel

Deliberately **not** a spinning "busy" icon. It shows the real decision the event loop makes at every instant:

- Whether the Call Stack is currently empty
- The two-step priority check it always runs, in order: *Microtask Queue first, Macrotask Queue second*
- Which of those is currently active, highlighted

The panel's title itself changes color to match the current phase (idle / running script / draining microtasks / running a macrotask), so the state is visible even at a glance.

### Console

Standard `console.log`/`warn`/`error` output, in the order it was actually printed, including the fact that `console.log` itself is a real function call and briefly appears on the Call Stack while it runs.

### Source line sync

The exact line currently executing is highlighted in a source pane alongside the diagram, with a smoothly animated highlight bar rather than an instant jump, so you can visually connect "this line" to "this event" without losing your place.

### Playback controls

Full VCR-style control over the replay: **Play / Pause**, **Next** / **Previous** step, **Restart**, a **speed** selector (0.5×–4×), and a **timeline scrubber** to jump to any point instantly. Every panel recomputes its state fresh from the trace at whatever step you land on, so scrubbing backward is exactly as correct as playing forward.

### EventLoop Guide (narration)

A toggleable, per-step caption bar explaining not just *what* happened but *why*. Captions come in two tiers:

| Tier | Example | Behavior |
|---|---|---|
| **Rule** | *"Call Stack is empty, so the event loop drains all microtasks before any macrotask."* | Always visible, even with the Guide toggled off |
| **Mechanical** | *"`console.log` is called and pushed onto the Call Stack."* | Hidden when the Guide is off |

The idea: the first time through, you want everything explained. The fiftieth time you replay the same file, you don't need to be told a function was called, but the *rule* explanations (the actual event-loop semantics) are worth seeing every time, so they never get hidden. The on/off preference is remembered across sessions.

> [!NOTE]
> These captions are deterministic, hand-written templates, not AI-generated per step. For a tool whose entire job is teaching correct JavaScript semantics, a wrong explanation would be worse than none; a small fixed set of templates can be verified correct once and stay correct forever, with zero runtime cost and no network dependency.

### Info tooltips

Every core panel (Call Stack, Heap, Web APIs, Microtask Queue, Macrotask Queue, Event Loop) has a small hoverable "i" next to its title with a plain-English definition of the concept, for when you're not sure what "Macrotask Queue" actually means, without having to leave the tool to look it up.

### Show Parsed AST (JSON)

A separate, simpler command that parses the active file and shows a flat JSON summary of what was found: variables, functions, calls, `console.log` sites, timers, and promise usage. This exists as a standalone window into how the AST parsing layer sees your code, independent of the full execution recorder.

---

## How It Works: Internal Architecture

### The recording pipeline

```mermaid
flowchart LR
    A["Active .js file<br/>(source code)"] --> B["AST Parser<br/>(acorn)"]
    B --> C["Source Instrumentor<br/>(splices trace hooks)"]
    C --> D["Sandboxed VM<br/>(Node vm module)"]
    D --> E["Monkey-patched APIs<br/>setTimeout / Promise.then /<br/>queueMicrotask / console"]
    D --> F["ExecutionStep[]<br/>(the recorded trace)"]
    F -->|postMessage| G["Webview<br/>(React)"]
    G --> H["computeStateAtStep<br/>(pure fold)"]
    H --> I["Panels<br/>(Call Stack, Heap, Queues, ...)"]
```

Concretely, five things happen when a file is recorded:

1. **Parse.** The source is parsed into an AST with [acorn](https://github.com/acornjs/acorn).
2. **Instrument.** Every function body gets `enter()`/`exit()` trace calls spliced in around it (via source-position splicing, not AST-to-source regeneration), and every `let`/`const`/`var` binding and function parameter gets a "re-snapshot to the Heap" call inserted at statement boundaries and function exits.
3. **Execute in a sandbox.** The instrumented source runs inside a Node [`vm`](https://nodejs.org/api/vm.html) context: a genuinely separate realm with its own `Promise` class, so patching it can never leak into or affect the extension host's own code. `setTimeout` is faked (no real waiting; delays are just used for ordering), while `Promise`/`async`/`await` are left as real, native, spec-correct behavior.
4. **Record.** Every push/pop, console call, and timer/microtask scheduling event becomes one entry in an ordered `ExecutionStep[]` array: the trace.
5. **Replay.** The trace is sent to the webview once; from then on, every panel's state at any point in time is derived by a single **pure fold** over `steps[0..index]`. Scrubbing the timeline backward is exactly as correct as playing forward, because nothing is mutated incrementally.

### Sequence: what happens when you click Visualize

```mermaid
sequenceDiagram
    participant You
    participant VSCode as VS Code Command
    participant Ext as Extension Host
    participant Sandbox as Recorder (vm sandbox)
    participant Panel as Webview Panel
    participant UI as React UI

    You->>VSCode: Click "Visualize Event Loop"
    VSCode->>Ext: activate eventloop-studio.visualize
    Ext->>Ext: Read active editor's source text
    Ext->>Panel: createOrShow()
    Ext->>Sandbox: recordTrace(sourceCode, fileName)
    Sandbox->>Sandbox: instrument() + run in vm context
    Sandbox-->>Ext: Trace { steps: ExecutionStep[] }
    Ext->>Panel: postTrace(trace)
    Panel->>UI: postMessage({ type: "trace", payload })
    UI->>UI: computeStateAtStep(steps, index) per panel
    UI-->>You: Animated, interactive replay
```

### The event loop's actual decision procedure

This is the core rule the entire tool exists to teach: the same logic the **Event Loop panel** displays live:

```mermaid
flowchart TD
    Start(["Engine is idle"]) --> CheckStack{"Is the Call Stack empty?"}
    CheckStack -- No --> RunSync["Keep running<br/>current code"]
    RunSync --> CheckStack
    CheckStack -- Yes --> CheckMicro{"Any microtasks<br/>queued?"}
    CheckMicro -- Yes --> RunMicro["Run ONE microtask<br/>(this may queue more)"]
    RunMicro --> CheckStack
    CheckMicro -- No --> CheckMacro{"Any macrotasks<br/>ready?"}
    CheckMacro -- Yes --> RunMacro["Run ONE macrotask"]
    RunMacro --> CheckStack
    CheckMacro -- No --> Wait["Wait for the next<br/>timer/event"]
    Wait --> CheckStack
```

The detail most people get wrong: after a microtask runs, the loop goes **back to checking the Call Stack and the Microtask Queue again**, not straight to the next macrotask. A microtask that queues another microtask keeps winning, every time, before any timer gets a turn. Every sample script in this project is built to make that visible.

---

## Project Structure

```
EventLoop Studio/
├── src/                          Extension host (Node.js side)
│   ├── extension.ts               Activation + command registration
│   ├── panel/
│   │   └── EventLoopPanel.ts      Webview lifecycle, HTML/CSP, message routing
│   ├── parser/
│   │   └── astSummary.ts          Standalone AST → JSON summary (Show Parsed AST)
│   ├── recorder/
│   │   ├── instrument.ts          Source-splicing instrumentation engine
│   │   └── sandbox.ts             vm sandbox, monkey-patched APIs, the driver loop
│   └── shared/
│       └── types.ts               ExecutionStep / Trace contract shared with the webview
│
├── webview-ui/                   The React application rendered inside the webview
│   ├── src/
│   │   ├── main.tsx                Webview entry point, message bridge to the host
│   │   ├── App.tsx                 Layout + computeStateAtStep (the core derivation logic)
│   │   ├── components/             One component per panel (CallStack, Heap, WebApis, ...)
│   │   ├── lib/captions.ts         The two-tier narration templates
│   │   ├── state/usePlayback.ts    Play/pause/speed/scrubber state machine
│   │   └── tailwind.css            Theme
│   ├── preview.html / preview-main.tsx   Standalone browser harness for UI development
│   └── mock-trace.json             Hand-authored fixture trace for the preview harness
│
├── samples/                      Example scripts demonstrating specific behaviors
├── media/                        Extension + toolbar icons
├── esbuild.js                    Build script (bundles extension host + webview separately)
└── package.json                  Extension manifest (commands, menus, activation)
```

| Layer | Responsibility |
|---|---|
| `src/recorder/` | The correctness-critical core: actually running code and producing a trustworthy trace |
| `src/parser/` | Lightweight, execution-free AST inspection |
| `src/panel/` + `src/extension.ts` | VS Code integration surface: commands, menus, webview hosting |
| `webview-ui/` | Everything the user sees: a self-contained React app, bundled independently from the extension host |

---

## Technical Decisions & Design Rationale

| Decision | Why |
|---|---|
| **Actually execute code in a `vm` sandbox, rather than statically simulating JS from the AST** | Static simulation cannot correctly handle recursion, loops, or branching without essentially re-implementing a JS interpreter. Running the real engine gets correctness for free. |
| **`setTimeout` is faked; `Promise`/`async`/`await` are left real** | Faking timers avoids actually waiting out real delays while recording. Promises are already fast and deterministic, and the native engine's ordering is spec-correct; reimplementing it would only introduce bugs. |
| **Source instrumentation via character-position splicing, not AST-to-source regeneration** | Avoids pulling in a full code-generation dependency; inserting trace calls at known offsets is simpler and has no risk of subtly rewriting semantics. |
| **The recorder's `vm` context patches its own `Promise.prototype`, never the extension host's** | A `vm` context is a genuinely separate realm with its own intrinsics. Patching the host's real `Promise` would risk corrupting unrelated extension-host behavior. |
| **Every scheduled item carries an explicit correlation id (`refId`), rather than being matched by label text** | Two timers can share an identical label (e.g. two `setTimeout(fn, 0)` calls). Matching by id is the only way to pair a "schedule" event with its "run" event unambiguously. |
| **Timer location (Web APIs vs. Macrotask Queue) is an explicit per-item fact, driven by a dedicated `timer-ready` event** | An earlier version inferred this from whether the call stack happened to be empty at a given instant, which flickered whenever unrelated code was executing. A per-item state machine can't flicker. |
| **The Heap re-snapshots at every statement boundary and function exit, wrapped in `try`/`catch`** | Reading a variable that isn't actually in scope at a given point would throw; wrapping each read means out-of-scope names are silently skipped rather than crashing the recording. |
| **Captions are deterministic hand-written templates, not LLM-generated** | Wrong explanations are actively harmful in a teaching tool. A small, fixed template set can be verified correct once, runs instantly, and needs no network access. |
| **Tailwind CSS compiled via its standalone CLI, not through esbuild's own CSS pipeline** | Keeps the two build concerns (JS bundling vs. CSS generation) independent and each replaceable on its own. |
| **The extension commits to one consistent light theme rather than mirroring the user's VS Code theme** | This is a dedicated visualization tool, not chrome embedded in the editor; a consistent, deliberately designed look reads as more polished than trying to reskin itself per theme. |

---

## Known Simplifications

Being upfront about where this tool takes a shortcut, and why it was a reasonable one:

- **Shadowed variables share one Heap slot.** The Heap is a flat, name-keyed view. If an inner scope declares its own `x` while an outer `x` is also in scope, both are tracked, but the panel shows whichever was most recently touched rather than two independent entries.
- **Async function call-stack frames are a pedagogical approximation.** In real JS, an `async` function's stack frame is popped at each `await` and re-pushed on resume. This tool's instrumentation marks function-body *boundaries*, not individual suspension points, so a frame can appear to stay "open" slightly longer than the real engine would show it. The console output and event ordering are still exactly correct; only the visual stack depth during an in-flight `await` is simplified.
- **Line highlighting is statement-granularity, one level into function bodies.** Deeply nested blocks (inside a loop body, for example) don't get their own line markers; the highlight reflects the nearest tracked statement.

---

## User Journey

1. **Open a `.js` file** you're curious about (or one of the [sample scripts](#sample-scripts)).
2. **Click "Visualize Event Loop"**, either from the Command Palette or the icon button in the editor's title bar.
3. A panel opens beside your editor, paused at the very start.
4. **Step forward** one event at a time, or hit **Play** and watch it run at a comfortable pace.
5. Watch a function call **land on the Call Stack**, watch a `setTimeout` **travel from Web APIs into the Macrotask Queue** once its delay is up, and watch it **fly onto the Call Stack** the instant the event loop actually picks it up.
6. Read the **EventLoop Guide** caption at each step for the "why," not just the "what."
7. **Scrub back** to any earlier point the moment something surprises you, without losing correctness.
8. Compare the **Console** panel's order against what you expected before you started: that gap is usually exactly the thing worth understanding.

---

## Sample Scripts

The `samples/` folder is a graded set of examples, roughly ordered from foundational to adversarial:

| File | What it exercises |
|---|---|
| `01-classic-ordering.js` | The canonical "sync → microtask → macrotask" ordering question |
| `02-nested-promises.js` | Microtasks that queue more microtasks while the queue is still draining |
| `03-async-await.js` | How `async`/`await` desugars to promise scheduling under the hood |
| `04-recursion-and-closures.js` | Call stack depth under recursion, and closure variable capture |
| `05-event-loop-challenge.js` | A deliberately dense mix of closures, shadowing, `async`, and interleaved timers/microtasks |
| `06-event-loop-challenge.js` | `this` binding across arrow functions, object methods, and `class` static/instance fields |
| `07-heap.js` | Reference vs. value semantics: shared object mutation vs. spread/`JSON` deep copies |

---

## Educational Value

This project is aimed at anyone who's used JavaScript's `setTimeout`/Promise ordering without ever being fully sure *why* it behaves the way it does, most commonly:

- **Students and bootcamp learners** meeting the event loop for the first time, who benefit from seeing the mechanism rather than memorizing "microtasks go first."
- **Interview candidates** brushing up before a JavaScript-fundamentals round: the event loop is one of the most common whiteboard questions, and watching it run removes the need to memorize rules by rote.
- **Working developers** debugging a real ordering bug, who want to step through their *actual* file rather than mentally simulating it.

It also doubles as a real-world example of several intermediate-to-advanced engineering techniques in one place: AST parsing, runtime code instrumentation, sandboxed execution, VS Code extension architecture, and building a deterministic replay UI from an event log.

---

## Roadmap

Planned or under consideration, not yet built:

- [ ] Automated test suite covering the recorder's ordering guarantees
- [ ] Performance pass for very large/long-running scripts
- [x] Marketplace publishing prep (icons and manifest metadata are in place, see checklist below)
- [ ] Multi-file / `import`-aware recording
- [ ] Broader per-panel definitions and an expanded sample library

---

## Publishing Checklist

Tracking progress toward an actual Marketplace release. Check items off as they're completed.

**Build & polish**
- [x] Core features complete (recorder, UI, animations, theming, narration, icons)
- [x] Professional README with architecture diagrams
- [x] Extension icon + toolbar icons (light/dark variants) finalized

**Repository**
- [x] Local git repository initialized, history organized into logical commits
- [x] GitHub remote configured
- [ ] Commits pushed to GitHub

**Manifest & packaging**
- [x] `package.json` metadata added (`repository`, `license`, `keywords`, `author`)
- [x] `.vscodeignore` added to keep the packaged `.vsix` lean (excludes source, keeps only compiled `out/`)
- [x] `LICENSE` file added
- [x] `CHANGELOG.md` added
- [ ] Replace the placeholder `"publisher"` value in `package.json` with your real registered publisher ID

**Marketplace account**
- [ ] Create a publisher on the [VS Code Marketplace](https://marketplace.visualstudio.com/manage) (requires an Azure DevOps organization)
- [ ] Generate a Personal Access Token with Marketplace publish scope

**Final release steps**
- [ ] `vsce package` locally and install the resulting `.vsix` via "Install from VSIX..." to sanity-check a clean build
- [ ] `vsce publish` to go live on the Marketplace
