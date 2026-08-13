import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { HostToWebviewMessage, Trace, WebviewToHostMessage } from '../shared/types';

export class EventLoopPanel {
  private static current: EventLoopPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private lastTrace: Trace | undefined;
  private readonly onRequestTrace: (mode: 'browser' | 'node') => void;
  /**
   * Whatever mode the last recorded trace actually used. Lets re-running "Visualize Event Loop"
   * on an already-open panel (e.g. after editing the file) preserve the user's current mode,
   * rather than always snapping back to 'browser'.
   */
  currentMode: 'browser' | 'node' = 'browser';

  static createOrShow(
    extensionUri: vscode.Uri,
    onRequestTrace: (mode: 'browser' | 'node') => void,
  ): EventLoopPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (EventLoopPanel.current) {
      EventLoopPanel.current.panel.reveal(column);
      return EventLoopPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'eventloopStudio',
      'EventLoop Studio',
      column ?? vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
      },
    );

    EventLoopPanel.current = new EventLoopPanel(panel, extensionUri, onRequestTrace);
    return EventLoopPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    onRequestTrace: (mode: 'browser' | 'node') => void,
  ) {
    this.panel = panel;
    this.onRequestTrace = onRequestTrace;
    this.panel.webview.html = this.buildHtml(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => {
        if (message.type === 'ready') {
          if (this.lastTrace) {
            this.send({ type: 'trace', payload: this.lastTrace });
          }
        } else if (message.type === 'requestTrace') {
          // Re-runs the active file fresh in the requested mode, e.g. when the user flips
          // the Browser/Node.js toggle, rather than just replaying the last recorded trace.
          this.onRequestTrace(message.mode);
        }
      },
      null,
      this.disposables,
    );
  }

  postTrace(trace: Trace): void {
    this.lastTrace = trace;
    this.currentMode = trace.mode;
    this.send({ type: 'trace', payload: trace });
  }

  private send(message: HostToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  private buildHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview.css'));
    const nonce = crypto.randomBytes(16).toString('base64');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>EventLoop Studio</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    EventLoopPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
