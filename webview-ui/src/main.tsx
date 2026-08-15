import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { HostToWebviewMessage, Trace } from '../../src/shared/types';
import { App } from './App';
// Styling is Tailwind CSS, compiled by the Tailwind CLI straight to out/webview.css
// and linked directly in the webview HTML (see EventLoopPanel.ts), not bundled here.

declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
  getState: () => any;
  setState: (s: any) => void;
};

// Must be called exactly once at module scope; VS Code throws if invoked twice.
const vscode = acquireVsCodeApi();

function Root() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [staleWarning, setStaleWarning] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent<HostToWebviewMessage>) {
      const message = event.data;
      if (!message) return;
      if (message.type === 'trace') {
        setHostError(null);
        setStaleWarning(null);
        setTrace(message.payload);
      } else if (message.type === 'error') {
        setHostError(message.message);
      } else if (message.type === 'staleSource') {
        // Deliberately doesn't touch `trace`; see the message type's own doc comment.
        setStaleWarning(message.message);
      }
    }

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return <App trace={trace} hostError={hostError} staleWarning={staleWarning} vscodeApi={vscode} />;
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('EventLoop Studio: #root element not found in webview HTML.');
}

ReactDOM.createRoot(container).render(<Root />);
