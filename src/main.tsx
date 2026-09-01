import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ReportsHub } from './ReportsHub';
import './styles.css';
import './reportsHub.css';

declare const __BUILD_ID__: string;

const DEPLOY_CHECK_INTERVAL_MS = 5000;

function watchForSuccessfulDeploy(): () => void {
  let stopped = false;
  let reloadStarted = false;

  const check = async () => {
    if (stopped || reloadStarted || document.visibilityState === 'hidden') return;
    try {
      const response = await fetch(`/build-meta.json?_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const metadata = (await response.json()) as { buildId?: string };
      if (metadata.buildId && metadata.buildId !== __BUILD_ID__) {
        reloadStarted = true;
        window.location.reload();
      }
    } catch {
      // Cloudflare may briefly swap versions; retry on the next interval.
    }
  };

  const timer = window.setInterval(check, DEPLOY_CHECK_INTERVAL_MS);
  void check();
  return () => { stopped = true; window.clearInterval(timer); };
}

watchForSuccessfulDeploy();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ReportsHub />
  </React.StrictMode>,
);
