import { MarkdownFormatConfig, StockItem } from '../types/stock';
import {
  DEFAULT_MD_CONFIG,
  compileWorkspaceToMarkdown,
  reextractNewsDates,
} from './markdownEngine';

const DB_NAME = 'jongmok_note_db';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';
const KEY_STOCKS = 'stocks_v1';
const KEY_CONFIG = 'config_v1';

const LS_KEY_STOCKS = 'jongmok_note_stocks_v1';
const LS_KEY_CONFIG = 'jongmok_note_md_config_v1';
const LS_KEY_PRUNED = 'jongmok_note_pruned_empty_v1';
const LS_KEY_SORT_ASC = 'jongmok_note_sort_asc_v1';
const LS_KEY_CLEAR_TODAY = 'jongmok_note_clear_today_v2';
const LS_KEY_CLEARED_EXISTING = 'jongmok_note_cleared_existing_v1';
const LS_KEY_IDB_CLEARED_EXISTING = 'jongmok_note_idb_cleared_existing_v1';
const LS_KEY_BOT_PRESET = 'jongmok_note_bot_preset_v1';

let localSaveTimer: ReturnType<typeof setTimeout> | null = null;
let latestPendingPayload: { stocks: StockItem[]; config?: MarkdownFormatConfig } | null = null;

function isLocalDesktopSession(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function sortStockNewsAsc(stocks: StockItem[], clearUnverifiedToday = false): StockItem[] {
  return reextractNewsDates(stocks, clearUnverifiedToday);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function flushLocalDiskSave(): Promise<void> {
  if (!isLocalDesktopSession() || !latestPendingPayload) return;
  const payload = latestPendingPayload;
  latestPendingPayload = null;
  try {
    const markdown =
      payload.stocks.length > 0
        ? compileWorkspaceToMarkdown(payload.stocks, payload.config ?? DEFAULT_MD_CONFIG)
        : '';
    await fetch('/api/local-archive/stocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stocks: payload.stocks, markdown }),
    });
  } catch {
    // ignore local disk sync errors; IndexedDB remains intact
  }
}

export function loadSyncStocksFallback(defaultStocks: StockItem[] = []): StockItem[] {
  try {
    if (!localStorage.getItem(LS_KEY_CLEARED_EXISTING)) {
      localStorage.setItem(LS_KEY_CLEARED_EXISTING, '1');
      localStorage.setItem(LS_KEY_STOCKS, '[]');
      return [];
    }
    const raw = localStorage.getItem(LS_KEY_STOCKS);
    if (raw) {
      const parsed = JSON.parse(raw) as StockItem[];
      if (Array.isArray(parsed)) {
        let result = parsed;
        if (!localStorage.getItem(LS_KEY_PRUNED)) {
          result = result.filter((s) => Array.isArray(s.news) && s.news.length > 0);
          localStorage.setItem(LS_KEY_PRUNED, '1');
        }
        const shouldClearToday = !localStorage.getItem(LS_KEY_CLEAR_TODAY);
        const normalized = sortStockNewsAsc(result, shouldClearToday);
        if (shouldClearToday) {
          localStorage.setItem(LS_KEY_CLEAR_TODAY, '1');
          localStorage.setItem(LS_KEY_STOCKS, JSON.stringify(normalized));
        }
        return normalized;
      }
    }
  } catch {
    // ignore storage errors
  }
  return sortStockNewsAsc(defaultStocks, false);
}

export async function loadPersistedStocks(): Promise<StockItem[] | undefined> {
  if (isLocalDesktopSession()) {
    try {
      const res = await fetch('/api/local-archive/stocks');
      if (res.ok) {
        const data = (await res.json()) as { exists?: boolean; stocks?: StockItem[] };
        if (data.exists && Array.isArray(data.stocks) && data.stocks.length > 0) {
          const normalized = sortStockNewsAsc(data.stocks, false);
          try {
            localStorage.setItem(LS_KEY_IDB_CLEARED_EXISTING, '1');
            await idbSet(KEY_STOCKS, normalized);
          } catch {
            // ignore IDB mirror error
          }
          return normalized;
        }
      }
    } catch {
      // fallback to IndexedDB
    }
  }

  try {
    if (!localStorage.getItem(LS_KEY_IDB_CLEARED_EXISTING)) {
      localStorage.setItem(LS_KEY_IDB_CLEARED_EXISTING, '1');
      await idbSet(KEY_STOCKS, []);
      return [];
    }
    const fromIdb = await idbGet<StockItem[]>(KEY_STOCKS);
    if (Array.isArray(fromIdb)) {
      let result = fromIdb;
      let changed = false;
      if (!localStorage.getItem(LS_KEY_PRUNED)) {
        result = result.filter((s) => Array.isArray(s.news) && s.news.length > 0);
        localStorage.setItem(LS_KEY_PRUNED, '1');
        changed = true;
      }
      const LS_KEY_IDB_CLEAR_TODAY = 'jongmok_note_idb_clear_today_v2';
      const shouldClearToday = !localStorage.getItem(LS_KEY_IDB_CLEAR_TODAY);
      const normalized = sortStockNewsAsc(result, shouldClearToday);
      if (shouldClearToday) {
        localStorage.setItem(LS_KEY_IDB_CLEAR_TODAY, '1');
        changed = true;
      }
      if (changed) {
        await idbSet(KEY_STOCKS, normalized);
      }
      return normalized;
    }
  } catch {
    // fallback to localStorage already loaded synchronously
  }
  return undefined;
}

export async function savePersistedStocks(
  stocks: StockItem[],
  config?: MarkdownFormatConfig,
): Promise<void> {
  try {
    localStorage.setItem(LS_KEY_STOCKS, JSON.stringify(stocks));
  } catch {
    // localStorage 5MB quota exceeded — IndexedDB below handles large datasets
  }
  try {
    await idbSet(KEY_STOCKS, stocks);
  } catch {
    // ignore IDB errors in restricted environments
  }

  if (isLocalDesktopSession()) {
    latestPendingPayload = { stocks, config };
    if (localSaveTimer) {
      clearTimeout(localSaveTimer);
    }
    localSaveTimer = setTimeout(() => {
      localSaveTimer = null;
      void flushLocalDiskSave();
    }, 600);
  }
}

export function loadSyncConfigFallback(defaultConfig: MarkdownFormatConfig): MarkdownFormatConfig {
  try {
    const raw = localStorage.getItem(LS_KEY_CONFIG);
    if (raw) {
      const merged = { ...defaultConfig, ...(JSON.parse(raw) as Partial<MarkdownFormatConfig>) };
      if (!localStorage.getItem(LS_KEY_SORT_ASC)) {
        merged.sortOrder = 'asc';
        localStorage.setItem(LS_KEY_SORT_ASC, '1');
        localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(merged));
      }
      if (!localStorage.getItem(LS_KEY_BOT_PRESET)) {
        merged.exportPreset = 'bot-archive';
        localStorage.setItem(LS_KEY_BOT_PRESET, '1');
        localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(merged));
      }
      return merged;
    }
  } catch {
    // ignore
  }
  return defaultConfig;
}

export async function savePersistedConfig(config: MarkdownFormatConfig): Promise<void> {
  try {
    localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(config));
  } catch {
    // ignore
  }
  try {
    await idbSet(KEY_CONFIG, config);
  } catch {
    // ignore
  }
  if (isLocalDesktopSession()) {
    try {
      await fetch('/api/local-archive/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
    } catch {
      // ignore
    }
  }
}
