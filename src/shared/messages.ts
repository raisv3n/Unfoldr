// Typed message contracts between popup, service worker, offscreen document and content scripts.

import type { AccessState, RawPage } from './raw';
import type { ExportSettings } from './settings';
import type { InTabFetchResult } from '../content/in-tab-fetch';

// ---- Content script commands (service worker → tab) -------------------------------------------

export type ContentCommand =
  | { target: 'notion-content'; cmd: 'probe' }
  | { target: 'notion-content'; cmd: 'step'; expandToggles: boolean; loadMore: boolean; maxClicks: number }
  | { target: 'notion-content'; cmd: 'extract'; url: string }
  | { target: 'notion-content'; cmd: 'restore' }
  | { target: 'notion-content' | 'external-content'; cmd: 'fetch'; url: string; maxBytes: number }
  | { target: 'external-content'; cmd: 'probe' }
  | { target: 'external-content'; cmd: 'step'; maxClicks: number }
  | { target: 'external-content'; cmd: 'extract'; url: string };

export interface ProbeResult {
  state: AccessState;
  pageId?: string;
  title?: string;
  blockCount: number;
  url: string;
}

export interface StepResult {
  blockCount: number;
  collapsedRemaining: number;
  clicked: number;
  atBottom: boolean;
  scrollHeight: number;
}

export type ExtractResult = { ok: true; page: RawPage } | { ok: false; error: string };
export type FetchInTabResult = InTabFetchResult;

// ---- Popup ⇄ service worker --------------------------------------------------------------------

export type JobPhase = 'idle' | 'crawling' | 'assets' | 'packaging' | 'downloading' | 'done' | 'cancelled' | 'error';
export type JobOutcome = 'success' | 'partial' | 'failed' | 'cancelled';

export interface JobProgress {
  jobId: string;
  phase: JobPhase;
  rootUrl: string;
  rootTitle?: string;
  startedAt: string;
  finishedAt?: string;
  pages: { queued: number; processing: number; completed: number; partial: number; failed: number; skipped: number };
  assets: { queued: number; downloaded: number; failed: number; skipped: number; bytes: number };
  currentUrl?: string;
  message?: string;
  outcome?: JobOutcome;
  limitsHit: string[];
  error?: string;
  zipName?: string;
  zipBytes?: number;
  reportMarkdown?: string;
  resumable?: boolean;
}

export type PopupRequest =
  | { type: 'getStatus' }
  | { type: 'startExport'; tabUrl: string; tabTitle?: string; settings: ExportSettings }
  | { type: 'cancelExport' }
  | { type: 'resumeExport' }
  | { type: 'discardResumable' }
  | { type: 'downloadAgain' }
  | { type: 'dismissResult' }
  | { type: 'probeTab'; tabId: number };

export type PopupResponse =
  | { ok: true; progress?: JobProgress; probe?: ProbeResult }
  | { ok: false; error: string };

export interface StatusBroadcast {
  type: 'jobProgress';
  progress: JobProgress;
}

// ---- Service worker ⇄ offscreen document -------------------------------------------------------

export type OffscreenRequest =
  | { target: 'offscreen'; type: 'createObjectUrl'; key: string }
  | { target: 'offscreen'; type: 'revokeObjectUrl'; url: string };

export type OffscreenResponse = { ok: true; url?: string } | { ok: false; error: string };
