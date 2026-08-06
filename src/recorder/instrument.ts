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
 *    Heap at each statement boundary and at every function exit (see heapRefreshSnippet below) —
 *    not just once at declaration time, so reassignments (`x++`, `x += ...`) actually show up.
 *
 * `setTimeout`, `Promise.prototype.then`, `queueMicrotask` and `console.log` are NOT touched
 * here — those are monkey-patched at the sandbox global level (see sandbox.ts) since they're a
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

  // Every `let`/`const`/`var` binding and simple function parameter, anywhere in the program —
  // used to re-snapshot the Heap at statement/function-exit boundaries below. Names that aren't
  // actually reachable at a given insertion point are silently skipped at runtime (see
  // heapRefreshSnippet's try/catch), so over-collecting here is harmless.
  const trackedNames = collectTrackedNames(ast);
  const heapRefresh = heapRefreshSnippet(trackedNames);

  function wrapFunctionBody(node: any, ancestors: any[]) {
    const label = getFunctionLabel(node, ancestors);
    const line = node.loc.start.line;
    const enterCall = `__trace.enter(${JSON.stringify(label)}, ${line});`;

    // The heap refresh goes *inside* the finally block (after it, code would be dead following
    // a `return`) — a finally block always runs, even after an early return, and JS guarantees
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
  });

  // Line + Heap markers: Program-level statements, plus the direct statements of every
  // block-bodied function (one level deep — not recursing into nested if/for/while blocks).
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
 * temporal dead zone) would throw a ReferenceError if referenced directly — the catch silently
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

function getFunctionLabel(node: any, ancestors: any[]): string {
  if (node.type === 'FunctionDeclaration' && node.id) {
    return `${node.id.name}()`;
  }

  const parent = ancestors[ancestors.length - 2];
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
      return `${parent.id.name}()`;
    }
    if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
      return `${parent.left.name}()`;
    }
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key.type === 'Identifier') {
      return `${parent.key.name}()`;
    }
    if (parent.type === 'CallExpression') {
      return `${describeCallee(parent.callee)} callback`;
    }
  }

  if (node.id?.name) {
    return `${node.id.name}()`;
  }
  return '<anonymous>()';
}
