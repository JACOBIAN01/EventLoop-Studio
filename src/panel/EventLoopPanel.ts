import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { HostToWebviewMessage, Trace, WebviewToHostMessage } from '../shared/types';

export class EventLoopPanel {
  private static current: EventLoopPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private lastTrace: Trace | undefined;

  static createOrShow(extensionUri: vscode.Uri): EventLoopPanel {
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

    EventLoopPanel.current = new EventLoopPanel(panel, extensionUri);
    return EventLoopPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => {
        if ((message.type === 'ready' || message.type === 'requestTrace') && this.lastTrace) {
          this.send({ type: 'trace', payload: this.lastTrace });
        }
      },
      null,
      this.disposables,
    );
  }

  postTrace(trace: Trace): void {
    this.lastTrace = trace;
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
