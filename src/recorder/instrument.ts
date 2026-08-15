import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import { describeCallee } from '../parser/astSummary';

/**
 * Rewrites source code so it phones home to a global `__trace` object at runtime:
 *  - every function body gets wrapped in `__trace.enter(label, line)` / `try {} finally { __trace.exit(label) }`
 *    so real function calls (including recursive ones) push/pop a call-stack frame.
 *  - every top-level statement (Program-level and one level inside each function body)
 *    gets a `__trace.line(n)` marker so the Webview can highlight the currently executing line.
 *  - every `let`/`const`/`var` binding and simple function parameter gets re-snapshotted to the
 *    Heap at each statement boundary and at every function exit (see heapRefreshSnippet below),
 *    not just once at declaration time, so reassignments (`x++`, `x += ...`) actually show up.
 *
 * `setTimeout`, `Promise.prototype.then`, `queueMicrotask` and `console.log` are NOT touched
 * here: those are monkey-patched at the sandbox global level (see sandbox.ts) since they're a
 * small, fixed set of APIs and patching the real objects is simpler and more robust than trying
 * to rewrite every call site.
 */

interface Insertion {
  pos: number;
  text: string;
  order: number;
}

export function instrument(sourceCode: string): string {
  const ast = parse(sourceCode, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
    ranges: true,
  });

  const insertions: Insertion[] = [];
  const insert = (pos: number, text: string, order = 0) => insertions.push({ pos, text, order });

  // Every `let`/`const`/`var` binding and simple function parameter, anywhere in the program,
  // used to re-snapshot the Heap at statement/function-exit boundaries below. Names that aren't
  // actually reachable at a given insertion point are silently skipped at runtime (see
  // heapRefreshSnippet's try/catch), so over-collecting here is harmless.
  const trackedNames = collectTrackedNames(ast);
  const heapRefresh = heapRefreshSnippet(trackedNames);

  function wrapFunctionBody(node: any, ancestors: any[]) {
    const { label, full } = getFunctionLabel(node, ancestors, sourceCode);
    const line = node.loc.start.line;
    // `full` is only ever longer than `label` when the label itself had to be truncated (an
    // inline callback's own code, capped so a Call Stack frame doesn't grow unbounded), passed
    // through so the UI can still show the complete, untruncated code on hover.
    const enterCall = `__trace.enter(${JSON.stringify(label)}, ${line}, ${JSON.stringify(full)});`;

    // The heap refresh goes *inside* the finally block (after it, code would be dead following
    // a `return`): a finally block always runs, even after an early return, and JS guarantees
    // it runs after the try's return value has already been computed (so it sees any side
    // effects, like `x++`, from evaluating that return expression) but before the function
    // actually hands the value back to its caller. That gets us fresh values on every exit path
    // without needing a temporary variable to hold the return value.
    if (node.body.type === 'BlockStatement') {
      const openBrace = node.body.start; // index of '{'
      const closeBrace = node.body.end - 1; // index of '}'
      insert(openBrace + 1, `\n${enterCall}\ntry{\n`, 0);
      insert(closeBrace, `\n}finally{\n${heapRefresh}__trace.exit(${JSON.stringify(label)});\n}\n`, 0);
    } else {
      // Arrow function with an expression body: `x => x + 1`
      const bodyStart = node.body.start;
      const bodyEnd = node.body.end;
      insert(bodyStart, `{\n${enterCall}\ntry{\nreturn (`, 0);
      insert(bodyEnd, `);\n}finally{\n${heapRefresh}__trace.exit(${JSON.stringify(label)});\n}\n}`, 0);
    }
  }

  walk.ancestor(ast, {
    FunctionDeclaration: wrapFunctionBody,
    FunctionExpression: wrapFunctionBody,
    ArrowFunctionExpression: wrapFunctionBody,
    CallExpression: tagSchedulerCallbackArgs,
  });

  // Stamps an inline callback passed directly to a known scheduling API (process.nextTick,
  // setTimeout, setImmediate, queueMicrotask, .then/.catch/.finally) with its own original,
  // pre-instrumentation source text, via __trace.tag(<fn>, "<src>"), a drop-in expression
  // wrapper, safe here specifically because a call argument is always an expression position,
  // never a declaration. Must read the snippet from the untouched `sourceCode`, before
  // wrapFunctionBody's insertions turn it into a __trace.enter/try/finally-laden body; the
  // recorder needs this to show *what the user actually wrote* in the queue panels, not the
  // rewritten internals. A callback passed by reference (an Identifier, not a literal) is left
  // alone; the recorder falls back to that function's own name instead (see sandbox.ts).
  function tagSchedulerCallbackArgs(node: any) {
    const callee = describeCallee(node.callee);
    const isSchedulerCall =
      callee === 'process.nextTick' ||
      callee === 'setTimeout' ||
      callee === 'setImmediate' ||
      callee === 'queueMicrotask' ||
      callee.endsWith('.then') ||
      callee.endsWith('.catch') ||
      callee.endsWith('.finally');
    if (!isSchedulerCall) {
      return;
    }
    for (const arg of node.arguments as any[]) {
      if (arg.type !== 'FunctionExpression' && arg.type !== 'ArrowFunctionExpression') {
        continue;
      }
      const snippet = sourceCode.slice(arg.start, arg.end).replace(/\s+/g, ' ').trim();
      insert(arg.start, '__trace.tag(', 1);
      insert(arg.end, `, ${JSON.stringify(snippet)})`, 1);
    }
  }

  // Line + Heap markers: Program-level statements, plus the direct statements of every
  // block-bodied function (one level deep, not recursing into nested if/for/while blocks).
  for (const stmt of ast.body as any[]) {
    insert(stmt.start, `__trace.line(${stmt.loc.start.line});\n`, -1);
    insert(stmt.end, `\n${heapRefresh}`, 1);
  }
  walk.simple(ast, {
    FunctionDeclaration: markBlockStatements,
    FunctionExpression: markBlockStatements,
    ArrowFunctionExpression: markBlockStatements,
  });
  function markBlockStatements(node: any) {
    if (node.body.type !== 'BlockStatement') {
      return;
    }
    for (const stmt of node.body.body) {
      insert(stmt.start, `__trace.line(${stmt.loc.start.line});\n`, -1);
      insert(stmt.end, `\n${heapRefresh}`, 1);
    }
  }

  return applyInsertions(sourceCode, insertions);
}

/** Collects every `let`/`const`/`var` identifier and simple function-parameter identifier. */
function collectTrackedNames(ast: any): Set<string> {
  const names = new Set<string>();
  walk.simple(ast, {
    VariableDeclarator(node: any) {
      if (node.id.type === 'Identifier') {
        names.add(node.id.name);
      }
    },
    Function(node: any) {
      for (const param of node.params) {
        if (param.type === 'Identifier') {
          names.add(param.name);
        } else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
          names.add(param.left.name);
        }
      }
    },
  });
  return names;
}

/**
 * Each candidate name is refreshed inside its own try/catch: a name that isn't actually in
 * scope at this exact point in the source (never declared here, or a `let`/`const` still in its
 * temporal dead zone) would throw a ReferenceError if referenced directly; the catch silently
 * skips it instead of crashing the user's program. Whichever names *are* reachable get a fresh
 * `heapSet`, which is exactly what lets the Heap panel reflect reassignments, not just the
 * value at the moment of declaration.
 */
function heapRefreshSnippet(names: Set<string>): string {
  if (names.size === 0) {
    return '';
  }
  const calls = [...names]
    .map((name) => `try{__trace.heapSet(${JSON.stringify(name)}, ${name});}catch(e){}`)
    .join('');
  return `${calls}\n`;
}

/** Collapses a source snippet to one line and caps its length, for display as a Call Stack
 *  frame label: unlike the queue panels (which keep the full snippet and truncate visually via
 *  CSS), a frame label is plain text with no truncation of its own, so the cap has to happen here. */
function truncateSnippet(text: string, max = 60): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function applyInsertions(sourceCode: string, insertions: Insertion[]): string {
  const byPos = new Map<number, string[]>();
  const ordered = [...insertions].sort((a, b) => a.order - b.order);
  for (const { pos, text } of ordered) {
    if (!byPos.has(pos)) {
      byPos.set(pos, []);
    }
    byPos.get(pos)!.push(text);
  }

  const positions = [...byPos.keys()].sort((a, b) => b - a);
  let output = sourceCode;
  for (const pos of positions) {
    const text = byPos.get(pos)!.join('');
    output = output.slice(0, pos) + text + output.slice(pos);
  }
  return output;
}

/**
 * `label` is what identifies the frame (rendered directly, and matched against on exit); `full`
 * is the same text UNTRUNCATED, identical to `label` for every named-binding case below, and
 * only actually longer than it for an inline callback's own source (see the CallExpression
 * branch), where `label` gets capped so a Call Stack frame doesn't grow unbounded. Callers pass
 * `full` through to the UI so the complete code is still available on hover.
 */
function getFunctionLabel(node: any, ancestors: any[], sourceCode: string): { label: string; full: string } {
  if (node.type === 'FunctionDeclaration' && node.id) {
    const label = `${node.id.name}()`;
    return { label, full: label };
  }

  const parent = ancestors[ancestors.length - 2];
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
      const label = `${parent.id.name}()`;
      return { label, full: label };
    }
    if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
      const label = `${parent.left.name}()`;
      return { label, full: label };
    }
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key.type === 'Identifier') {
      const label = `${parent.key.name}()`;
      return { label, full: label };
    }
    if (parent.type === 'CallExpression') {
      // An inline callback passed straight to a call (setTimeout(() => ..., 0),
      // somePromise.then(() => ...), arr.forEach(() => ...), etc.), showing the callback's own
      // code on its Call Stack frame is far more useful than a generic "<callee> callback"
      // label, especially for chains like `Promise.resolve().then(...)` where the callee itself
      // can't be described any more specifically than "<expression>.then".
      const full = sourceCode.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
      return { label: truncateSnippet(full), full };
    }
  }

  if (node.id?.name) {
    const label = `${node.id.name}()`;
    return { label, full: label };
  }
  return { label: '<anonymous>()', full: '<anonymous>()' };
}
