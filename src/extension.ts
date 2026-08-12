import * as vscode from 'vscode';
import { COMMANDS } from './shared/types';
import { EventLoopPanel } from './panel/EventLoopPanel';
import { recordTrace } from './recorder/sandbox';
import { buildAstSummary } from './parser/astSummary';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.visualize, () => visualizeEventLoop(context, 'browser')),
    vscode.commands.registerCommand(COMMANDS.showAst, () => showAstSummary()),
    vscode.commands.registerCommand(COMMANDS.helloDeveloper, () => {
      vscode.window.showInformationMessage('Hello Subhadeep');
    }),
  );
}

async function visualizeEventLoop(context: vscode.ExtensionContext, mode: 'browser' | 'node') {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'javascript') {
    vscode.window.showWarningMessage(
      'Open a JavaScript file first, then run "Visualize Event Loop".',
    );
    return;
  }

  const panel = EventLoopPanel.createOrShow(context.extensionUri, (newMode) =>
    visualizeEventLoop(context, newMode),
  );
  const trace = await recordTrace(editor.document.getText(), editor.document.fileName, mode);
  panel.postTrace(trace);
}

async function showAstSummary() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'javascript') {
    vscode.window.showWarningMessage('Open a JavaScript file first, then run this command again.');
    return;
  }

  try {
    const summary = buildAstSummary(editor.document.getText());
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(summary, null, 2),
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Could not parse this file as JavaScript: ${err.message}`);
  }
}

export function deactivate() {}
