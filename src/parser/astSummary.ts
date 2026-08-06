import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import { AstSummary } from '../shared/types';

/**
 * Phase 4 deliverable: parse source into an AST and extract a flat,
 * human-inspectable summary — no execution, no instrumentation.
 */
export function buildAstSummary(sourceCode: string): AstSummary {
  const ast = parse(sourceCode, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });

  const summary: AstSummary = {
    variables: [],
    functions: [],
    calls: [],
    consoleLogs: [],
    timers: [],
    promises: [],
  };

  walk.ancestor(ast, {
    VariableDeclarator(node: any, _state: any, ancestors: any[]) {
      if (node.id.type !== 'Identifier') {
        return;
      }
      const declaration = ancestors[ancestors.length - 2];
      summary.variables.push({
        name: node.id.name,
        kind: declaration?.kind ?? 'var',
        line: node.loc.start.line,
      });
    },
    FunctionDeclaration(node: any) {
      summary.functions.push({
        name: node.id?.name ?? '<anonymous>',
        line: node.loc.start.line,
        params: node.params.length,
      });
    },
    FunctionExpression(node: any) {
      summary.functions.push({
        name: node.id?.name ?? '<anonymous function expression>',
        line: node.loc.start.line,
        params: node.params.length,
      });
    },
    ArrowFunctionExpression(node: any) {
      summary.functions.push({
        name: '<arrow function>',
        line: node.loc.start.line,
        params: node.params.length,
      });
    },
    CallExpression(node: any) {
      const callee = describeCallee(node.callee);
      summary.calls.push({ callee, line: node.loc.start.line });

      if (callee === 'console.log') {
        summary.consoleLogs.push({ line: node.loc.start.line });
      }
      if (callee === 'setTimeout' || callee === 'setInterval') {
        summary.timers.push({ line: node.loc.start.line });
      }
      if (
        callee.startsWith('Promise.') ||
        callee.endsWith('.then') ||
        callee.endsWith('.catch') ||
        callee.endsWith('.finally')
      ) {
        summary.promises.push({ line: node.loc.start.line });
      }
    },
  });

  return summary;
}

export function describeCallee(callee: any): string {
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (callee.type === 'MemberExpression') {
    const objectName =
      callee.object.type === 'Identifier' ? callee.object.name : describeCallee(callee.object);
    const propertyName = callee.property.type === 'Identifier' ? callee.property.name : '<computed>';
    return `${objectName}.${propertyName}`;
  }
  return '<expression>';
}
