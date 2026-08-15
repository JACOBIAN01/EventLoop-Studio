/**
 * Standalone preview entry point: NOT part of the production webview bundle.
 * Lets us self-verify layout + playback logic in a plain browser, without a
 * running VS Code Extension Host. When `acquireVsCodeApi` isn't present (i.e.
 * we're not inside a real webview), falls back to fetching mock-trace.json.
 */
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { Trace } from '../src/shared/types';
import { App } from './src/App';
// Styling is Tailwind CSS, compiled by the Tailwind CLI straight to preview-bundle.css
// and linked directly in preview.html, not bundled here (same setup as main.tsx/webview.css).

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (msg: any) => void; getState: () => any; setState: (s: any) => void };
  }
}

// Simple in-memory stand-in for vscode.getState/setState so the Captions toggle's
// persistence is still exercisable in this standalone preview (module-scope, so it
// at least survives across re-renders within the same page load).
let previewState: any = {};
const previewStateApi = {
  getState: () => previewState,
  setState: (s: any) => {
    previewState = s;
  },
};

function PreviewRoot() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window.acquireVsCodeApi === 'function') {
      // We're somehow inside a real webview: behave like the production entry.
      const vscode = window.acquireVsCodeApi();
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'trace') setTrace(event.data.payload);
      };
      window.addEventListener('message', handleMessage);
      vscode.postMessage({ type: 'ready' });
      return () => window.removeEventListener('message', handleMessage);
    }

    fetch('./mock-trace.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch mock-trace.json: ${res.status}`);
        return res.json();
      })
      .then((data: Trace) => setTrace(data))
      .catch((err) => setError(String(err)));
  }, []);

  return <App trace={trace} hostError={error} vscodeApi={previewStateApi} />;
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('preview: #root element not found.');
}

ReactDOM.createRoot(container).render(<PreviewRoot />);
