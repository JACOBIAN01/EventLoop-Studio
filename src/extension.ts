import * as vscode from 'vscode';
import { COMMANDS } from './shared/types';
import { EventLoopPanel } from './panel/EventLoopPanel';
import { recordTrace } from './recorder/sandbox';
import { buildAstSummary } from './parser/astSummary';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.visualize, () => visualizeEventLoop(context)),
    vscode.commands.registerCommand(COMMANDS.showAst, () => showAstSummary()),
    vscode.workspace.onDidSaveTextDocument((document) => reRecordOnSave(document)),
  );
}

/** Whichever file was last successfully visualized, so the Browser/Node.js toggle can re-run it. */
let lastVisualizedDocument: vscode.TextDocument | undefined;

/**
 * `modeOverride` is only passed when the webview itself asks for a specific mode (the
 * Browser/Node.js toggle). Re-running the command with no override, e.g. after editing the
 * file, keeps whatever mode the panel is already showing instead of resetting to 'browser'.
 */
async function visualizeEventLoop(context: vscode.ExtensionContext, modeOverride?: 'browser' | 'node') {
  const editor = vscode.window.activeTextEditor;
  let document: vscode.TextDocument;

  if (editor && editor.document.languageId === 'javascript') {
    document = editor.document;
  } else if (modeOverride && lastVisualizedDocument) {
    // The toggle lives inside the webview panel, so clicking it moves focus there; by the
    // time this runs, activeTextEditor is undefined (no text editor has focus), not the file
    // being visualized. Fall back to whichever file this panel is already showing.
    document = lastVisualizedDocument;
  } else {
    vscode.window.showWarningMessage(
      'Open a JavaScript file first, then run "Visualize Event Loop".',
    );
    return;
  }

  lastVisualizedDocument = document;
  const panel = EventLoopPanel.createOrShow(context.extensionUri, (newMode) =>
    visualizeEventLoop(context, newMode),
  );
  const mode = modeOverride ?? panel.currentMode;
  const trace = await recordTrace(document.getText(), document.fileName, mode);
  panel.postTrace(trace);
}

/**
 * Auto-refreshes the open panel when its visualized file is saved, so the user doesn't have to
 * close/reopen or manually re-run the command after every edit. Deliberately narrower than
 * visualizeEventLoop: it never creates or reveals a panel (a background save shouldn't pop one
 * open or steal focus), and a save that fails to parse doesn't blank the panel via postTrace:
 * it's flagged via notifyStaleSource instead, leaving whatever last worked on screen.
 */
async function reRecordOnSave(document: vscode.TextDocument) {
  const panel = EventLoopPanel.current;
  if (!panel || !lastVisualizedDocument || document.uri.toString() !== lastVisualizedDocument.uri.toString()) {
    return;
  }

  const trace = await recordTrace(document.getText(), document.fileName, panel.currentMode);
  if (trace.error) {
    panel.notifyStaleSource(trace.error);
    return;
  }
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
