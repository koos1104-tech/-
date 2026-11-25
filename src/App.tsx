import { useEffect, useRef, useState } from 'react';
import { BatchMergeView } from './components/BatchMergeView';
import { ImportModal } from './components/ImportModal';
import { MasterMarkdownView } from './components/MasterMarkdownView';
import { QuickJumpModal } from './components/QuickJumpModal';
import { StockSidebar } from './components/StockSidebar';
import { StockWorkspace } from './components/StockWorkspace';
import { ActiveTab, TopNav } from './components/TopNav';
import {
  MarkdownFormatConfig,
  MarketType,
  NewsCategory,
  NewsEntry,
  ParsedMergeCandidate,
  QuickNewsSaveResult,
  StockItem,
} from './types/stock';
import {
  DEFAULT_MD_CONFIG,
  UNCLASSIFIED_STOCK_NAME,
  compareNewsDates,
  consolidateUnclassifiedStocks,
  createId,
  extractDateFromContent,
  extractDomainLabel,
  inferCategory,
  isInvalidStockHeading,
  isMissingOrGenericTitle,
  isUnclassifiedStock,
  normalizeStockNameKey,
  normalizeUrl,
  parseStockHeading,
  stripDecorativeDividers,
} from './utils/markdownEngine';
import {
  loadPersistedStocks,
  loadSyncConfigFallback,
  loadSyncStocksFallback,
  savePersistedConfig,
  savePersistedStocks,
} from './utils/storage';

export default function App() {
  const [stocks, setStocks] = useState<StockItem[]>(() => loadSyncStocksFallback([]));
  const [mdConfig, setMdConfig] = useState<MarkdownFormatConfig>(() =>
    loadSyncConfigFallback(DEFAULT_MD_CONFIG),
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');
  const [selectedStockId, setSelectedStockId] = useState<string>(() => {
    const initial = loadSyncStocksFallback([]);
    return initial[0]?.id ?? '';
  });
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isQuickJumpOpen, setIsQuickJumpOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [newsSearchRequest, setNewsSearchRequest] = useState<{
    id: number;
    query: string;
    targetStockId?: string;
  } | null>(null);
  const attemptedMetaUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsQuickJumpOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  useEffect(() => {
    let active = true;
    loadPersistedStocks()
      .then((persisted) => {
        if (!active) return;
        if (persisted) {
          setStocks(persisted);
          if (persisted[0]) setSelectedStockId(persisted[0].id);
        }
      })
      .finally(() => {
        if (active) setHasHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    void savePersistedStocks(stocks, mdConfig);
  }, [stocks, mdConfig, hasHydrated]);

  // Automatically resolve missing news titles (or publish dates on small workspaces) in the background
  useEffect(() => {
    if (!hasHydrated) return;
    const allNews = stocks.flatMap((s) => s.news);
    const missingTitleUrls = allNews
      .filter(
        (n) =>
          isMissingOrGenericTitle(n.title, n.url) &&
          n.url &&
          !attemptedMetaUrlsRef.current.has(n.url),
      )
      .map((n) => n.url);
    const missingDateUrls = allNews
      .filter((n) => !n.date && n.url && !attemptedMetaUrlsRef.current.has(n.url))
      .map((n) => n.url);

    const targetList =
      missingDateUrls.length <= 150
        ? [...missingTitleUrls, ...missingDateUrls]
        : missingTitleUrls;
    const missingUrls = Array.from(new Set(targetList));
    if (missingUrls.length === 0) return;

    for (const u of missingUrls) {
      attemptedMetaUrlsRef.current.add(u);
    }

    let cancelled = false;
    (async () => {
      const resolvedMap: Record<string, { title?: string; date?: string }> = {};
      for (let i = 0; i < missingUrls.length; i += 50) {
        if (cancelled) return;
        const batch = missingUrls.slice(i, i + 50);
        try {
          const res = await fetch('/api/fetch-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: batch }),
          });
          const data = (await res.json()) as {
            results?: Record<string, { title?: string; date?: string }>;
          };
          for (const [url, meta] of Object.entries(data.results || {})) {
            const resolvedTitle = meta?.title?.trim() || undefined;
            const resolvedDate =
              meta?.date || (resolvedTitle ? extractDateFromContent(resolvedTitle, url) : undefined);
            if (resolvedTitle || resolvedDate) {
              resolvedMap[url] = { title: resolvedTitle, date: resolvedDate };
            }
          }
        } catch {
          // ignore network errors per batch
        }
      }

      if (cancelled || Object.keys(resolvedMap).length === 0) return;
      setStocks((prev) =>
        prev.map((s) => {
          let changed = false;
          const updatedNews = s.news.map((n) => {
            const resolved = resolvedMap[n.url];
            if (!resolved) return n;
            let next = n;
            if (isMissingOrGenericTitle(next.title, next.url) && resolved.title) {
              const nextCategory =
                next.category === '일반'
                  ? inferCategory(resolved.title, next.url)
                  : next.category;
              next = { ...next, title: resolved.title, category: nextCategory };
              changed = true;
            }
            if (!next.date && resolved.date) {
              next = { ...next, date: resolved.date };
              changed = true;
            }
            return next;
          });
          if (!changed) return s;
          const finalNews = updatedNews.every((n) => Boolean(n.date))
            ? updatedNews.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
            : updatedNews;
          return {
            ...s,
            news: finalNews,
          };
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [stocks, hasHydrated]);

  useEffect(() => {
    void savePersistedConfig(mdConfig);
  }, [mdConfig]);

  useEffect(() => {
    if (stocks.length > 0 && !stocks.some((s) => s.id === selectedStockId)) {
      setSelectedStockId(stocks[0].id);
    }
  }, [stocks, selectedStockId]);

  const selectedStock = stocks.find((s) => s.id === selectedStockId);

  const handleAddStock = (
    name: string,
    ticker: string,
    market: MarketType,
    sector: string,
  ) => {
    const cleanName = stripDecorativeDividers(name);
    if (!cleanName || isInvalidStockHeading(cleanName)) return;
    const newStock: StockItem = {
      id: createId('stk'),
      name: cleanName,
      ticker,
      market,
      sector: stripDecorativeDividers(sector),
      aliases: [],
      summaryNote: '',
      news: [],
      updatedAt: new Date().toISOString(),
    };
    setStocks((prev) => [newStock, ...prev]);
    setSelectedStockId(newStock.id);
    setActiveTab('workspace');
  };

  const handleDeleteStock = (id: string) => {
    setStocks((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDeleteEmptyStocks = () => {
    setStocks((prev) => prev.filter((s) => s.news.length > 0));
  };

  const handleClearAllStocks = () => {
    setStocks([]);
    setSelectedStockId('');
  };

  const handleUpdateStock = (updated: StockItem) => {
    setStocks((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleMoveNewsBulk = (
    newsIds: string[],
    fromStockId: string,
    toStockId: string,
    newStockName?: string,
  ) => {
    if (newsIds.length === 0) return;
    const idSet = new Set(newsIds);
    const sourceStock = stocks.find((s) => s.id === fromStockId);
    if (!sourceStock) return;
    const movingItems = sourceStock.news.filter((n) => idSet.has(n.id));
    if (movingItems.length === 0) return;

    let createdStockId = '';
    const trimmedNewName = (newStockName || '').trim();

    setStocks((prev) => {
      let targetId = toStockId;
      const next = prev.map((s) => ({ ...s }));

      if (!targetId && trimmedNewName) {
        const parsed = parseStockHeading(trimmedNewName);
        const existing = next.find(
          (s) =>
            !isUnclassifiedStock(s) &&
            ((parsed.ticker && s.ticker && s.ticker.toUpperCase() === parsed.ticker.toUpperCase()) ||
              s.name.toLowerCase() === parsed.name.toLowerCase()),
        );
        if (existing) {
          targetId = existing.id;
        } else {
          createdStockId = createId('stk');
          targetId = createdStockId;
          next.unshift({
            id: createdStockId,
            name: parsed.name,
            ticker: parsed.ticker,
            market: parsed.market,
            sector: parsed.sector,
            aliases: [],
            summaryNote: '',
            news: [],
            updatedAt: new Date().toISOString(),
          });
        }
      }

      if (!targetId || targetId === fromStockId) return prev;

      const updated = next
        .map((s) => {
          if (s.id === fromStockId) {
            return {
              ...s,
              news: s.news.filter((n) => !idSet.has(n.id)),
              updatedAt: new Date().toISOString(),
            };
          }
          if (s.id === targetId) {
            const seenUrls = new Set(s.news.map((n) => n.normalizedUrl).filter(Boolean));
            const uniqueNew = movingItems.filter((item) => {
              if (!item.normalizedUrl) return true;
              if (seenUrls.has(item.normalizedUrl)) return false;
              seenUrls.add(item.normalizedUrl);
              return true;
            });
            return {
              ...s,
              news: [...s.news, ...uniqueNew].sort((a, b) =>
                compareNewsDates(a.date, b.date, 'asc'),
              ),
              updatedAt: new Date().toISOString(),
            };
          }
          return s;
        })
        .filter((s) => !(isUnclassifiedStock(s) && s.news.length === 0));

      return consolidateUnclassifiedStocks(updated);
    });
  };

  const handleMoveNewsMap = (
    moves: Array<{ newsId: string; toStockId: string }>,
    fromStockId: string,
  ) => {
    if (moves.length === 0) return;
    const moveTargetById = new Map(moves.map((m) => [m.newsId, m.toStockId]));

    setStocks((prev) => {
      const sourceStock = prev.find((s) => s.id === fromStockId);
      if (!sourceStock) return prev;
      const itemsByTarget = new Map<string, NewsEntry[]>();
      const movedIds = new Set<string>();

      for (const n of sourceStock.news) {
        const targetId = moveTargetById.get(n.id);
        if (targetId && targetId !== fromStockId) {
          movedIds.add(n.id);
          const arr = itemsByTarget.get(targetId) ?? [];
          arr.push(n);
          itemsByTarget.set(targetId, arr);
        }
      }
      if (movedIds.size === 0) return prev;

      const updated = prev
        .map((s) => {
          if (s.id === fromStockId) {
            return {
              ...s,
              news: s.news.filter((n) => !movedIds.has(n.id)),
              updatedAt: new Date().toISOString(),
            };
          }
          const incoming = itemsByTarget.get(s.id);
          if (incoming && incoming.length > 0) {
            const seenUrls = new Set(s.news.map((n) => n.normalizedUrl).filter(Boolean));
            const uniqueNew = incoming.filter((item) => {
              if (!item.normalizedUrl) return true;
              if (seenUrls.has(item.normalizedUrl)) return false;
              seenUrls.add(item.normalizedUrl);
              return true;
            });
            return {
              ...s,
              news: [...s.news, ...uniqueNew].sort((a, b) =>
                compareNewsDates(a.date, b.date, 'asc'),
              ),
              updatedAt: new Date().toISOString(),
            };
          }
          return s;
        })
        .filter((s) => !(isUnclassifiedStock(s) && s.news.length === 0));

      return consolidateUnclassifiedStocks(updated);
    });
  };

  const handleMoveNews = (newsId: string, fromStockId: string, toStockId: string) => {
    handleMoveNewsBulk([newsId], fromStockId, toStockId);
  };

  const handleImportStocks = (parsedStocks: StockItem[], mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const cleaned = consolidateUnclassifiedStocks(parsedStocks);
      setStocks(cleaned);
      if (cleaned[0]) setSelectedStockId(cleaned[0].id);
      setActiveTab('workspace');
      return;
    }

    setStocks((prev) => {
      const next = [...prev];
      for (const incoming of parsedStocks) {
        const krxTicker = /^\d{6}$/.test(incoming.ticker) ? incoming.ticker : '';
        const incomingNameKey = normalizeStockNameKey(incoming.name);
        const existingIdx = next.findIndex((s) => {
          if (isUnclassifiedStock(incoming) && isUnclassifiedStock(s)) return true;
          return (
            (krxTicker && s.ticker === krxTicker) ||
            normalizeStockNameKey(s.name) === incomingNameKey
          );
        });
        if (existingIdx === -1) {
          next.push(incoming);
        } else {
          const existing = next[existingIdx];
          const seenUrls = new Set(existing.news.map((n) => n.normalizedUrl).filter(Boolean));
          const uniqueIncomingNews = incoming.news.filter((n) => {
            if (!n.normalizedUrl) return true;
            if (seenUrls.has(n.normalizedUrl)) return false;
            seenUrls.add(n.normalizedUrl);
            return true;
          });
          const sortedIncoming = [...uniqueIncomingNews].sort((a, b) =>
            compareNewsDates(a.date, b.date, 'asc'),
          );
          const combinedNews = [...existing.news, ...sortedIncoming];
          const finalNews =
            combinedNews.length > 1 && combinedNews.every((n) => Boolean(n.date))
              ? combinedNews.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
              : combinedNews;
          next[existingIdx] = {
            ...existing,
            ticker: existing.ticker || incoming.ticker,
            sector: existing.sector || incoming.sector,
            market: existing.market !== '미분류' ? existing.market : incoming.market,
            summaryNote: existing.summaryNote || incoming.summaryNote,
            news: finalNews,
            updatedAt: new Date().toISOString(),
          };
        }
      }
      return consolidateUnclassifiedStocks(next);
    });
    setActiveTab('workspace');
  };

  const handleCommitBatchMerge = (
    candidates: ParsedMergeCandidate[],
    newStocksToCreate: Array<{ name: string; ticker: string }>,
  ) => {
    setStocks((prev) => {
      const next = [...prev];
      const createdIdMap = new Map<string, string>();

      for (const ns of newStocksToCreate) {
        const key = `${ns.name.toLowerCase()}__${ns.ticker.toUpperCase()}`;
        const existing = next.find(
          (s) =>
            (ns.ticker && s.ticker === ns.ticker) ||
            s.name.toLowerCase() === ns.name.toLowerCase(),
        );
        if (existing) {
          createdIdMap.set(key, existing.id);
        } else {
          const newId = createId('stk');
          const created: StockItem = {
            id: newId,
            name: ns.name,
            ticker: ns.ticker,
            market: ns.ticker && /^[A-Z.]+$/.test(ns.ticker) ? '해외' : '미분류',
            sector: '',
            aliases: [],
            summaryNote: '',
            news: [],
            updatedAt: new Date().toISOString(),
          };
          next.push(created);
          createdIdMap.set(key, newId);
        }
      }

      for (const cand of candidates) {
        let targetId = cand.matchedStockId;
        if (!targetId) {
          const rawName = cand.suggestedNewStockName.trim();
          const name =
            !rawName || isInvalidStockHeading(rawName) ? UNCLASSIFIED_STOCK_NAME : rawName;
          const ticker =
            name === UNCLASSIFIED_STOCK_NAME ? '' : cand.suggestedNewTicker.trim().toUpperCase();
          const key = `${name.toLowerCase()}__${ticker}`;
          targetId = createdIdMap.get(key) ?? '';
        }

        const idx = next.findIndex((s) => s.id === targetId);
        if (idx === -1) continue;

        const targetStock = next[idx];
        const normUrl = cand.normalizedUrl || normalizeUrl(cand.url);
        const alreadyExists =
          normUrl && targetStock.news.some((n) => n.normalizedUrl === normUrl);
        if (alreadyExists) continue;

        const entry: NewsEntry = {
          id: createId('news'),
          title: stripDecorativeDividers(cand.title) || cand.url,
          url: cand.url.trim(),
          normalizedUrl: normUrl,
          date: cand.date,
          source: cand.source || extractDomainLabel(cand.url),
          category: cand.category,
          memo: stripDecorativeDividers(cand.memo),
          addedAt: new Date().toISOString(),
        };

        const combinedNews = [...targetStock.news, entry];
        const finalNews =
          combinedNews.length > 1 && combinedNews.every((n) => Boolean(n.date))
            ? combinedNews.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
            : combinedNews;
        next[idx] = {
          ...targetStock,
          news: finalNews,
          updatedAt: new Date().toISOString(),
        };
      }

      return consolidateUnclassifiedStocks(next);
    });
  };

  const handleSearchStockNews = (query: string, targetStockId?: string) => {
    const clean = query.trim();
    if (!clean) return;
    if (targetStockId) {
      setSelectedStockId(targetStockId);
    }
    setActiveTab('workspace');
    setNewsSearchRequest({
      id: Date.now() + Math.floor(Math.random() * 1000),
      query: clean,
      targetStockId,
    });
  };

  const handleAddNewsItemsToStock = (
    items: Array<{
      title: string;
      url: string;
      date: string;
      source: string;
      category: NewsCategory;
    }>,
    targetStockId?: string,
    newStockName?: string,
  ): number => {
    if (items.length === 0) return 0;

    let resolvedId = targetStockId || '';
    const trimmedNewName = (newStockName || '').trim();
    let createdNewId = '';
    if (!resolvedId && trimmedNewName) {
      const parsed = parseStockHeading(trimmedNewName);
      const existing = stocks.find(
        (s) =>
          !isUnclassifiedStock(s) &&
          ((parsed.ticker && s.ticker && s.ticker.toUpperCase() === parsed.ticker.toUpperCase()) ||
            normalizeStockNameKey(s.name) === normalizeStockNameKey(parsed.name)),
      );
      if (existing) {
        resolvedId = existing.id;
      } else if (!isInvalidStockHeading(parsed.name)) {
        createdNewId = createId('stk');
        resolvedId = createdNewId;
      }
    }

    if (!resolvedId) return 0;

    let addedCount = 0;
    const nowIso = new Date().toISOString();

    setStocks((prev) => {
      const next = [...prev];
      let idx = next.findIndex((s) => s.id === resolvedId);

      if (idx === -1 && createdNewId && trimmedNewName) {
        const parsed = parseStockHeading(trimmedNewName);
        const created: StockItem = {
          id: createdNewId,
          name: parsed.name,
          ticker: parsed.ticker,
          market: parsed.market,
          sector: parsed.sector,
          aliases: [],
          summaryNote: '',
          news: [],
          updatedAt: nowIso,
        };
        next.unshift(created);
        idx = 0;
      }

      if (idx === -1) return prev;

      const target = next[idx];
      const seenUrls = new Set(target.news.map((n) => n.normalizedUrl).filter(Boolean));
      const entries: NewsEntry[] = [];

      for (const item of items) {
        const cleanUrl = item.url.trim();
        const normUrl = normalizeUrl(cleanUrl);
        if (normUrl && seenUrls.has(normUrl)) continue;
        if (normUrl) seenUrls.add(normUrl);
        entries.push({
          id: createId('news'),
          title: stripDecorativeDividers(item.title) || cleanUrl,
          url: cleanUrl,
          normalizedUrl: normUrl,
          date: item.date,
          source: item.source || extractDomainLabel(cleanUrl),
          category: item.category,
          memo: '',
          addedAt: nowIso,
        });
      }

      if (entries.length === 0) return prev;
      addedCount = entries.length;

      const combined = [...target.news, ...entries];
      const finalNews =
        combined.length > 1 && combined.every((n) => Boolean(n.date))
          ? combined.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
          : combined;

      next[idx] = {
        ...target,
        news: finalNews,
        updatedAt: nowIso,
      };
      return next;
    });

    if (createdNewId) {
      setSelectedStockId(createdNewId);
    }

    return addedCount || items.length;
  };

  const handleSaveQuickNews = (
    entryInput: Omit<NewsEntry, 'id' | 'addedAt'>,
    options: { targetStockIds: string[]; newStockName?: string },
  ): QuickNewsSaveResult => {
    const nowIso = new Date().toISOString();
    const trimmedNewName = (options.newStockName || '').trim();

    if (trimmedNewName) {
      const parsed = parseStockHeading(trimmedNewName);
      const existing = stocks.find(
        (s) =>
          !isUnclassifiedStock(s) &&
          ((parsed.ticker && s.ticker && s.ticker.toUpperCase() === parsed.ticker.toUpperCase()) ||
            normalizeStockNameKey(s.name) === normalizeStockNameKey(parsed.name)),
      );

      if (existing) {
        const dup = existing.news.find(
          (n) => entryInput.normalizedUrl && n.normalizedUrl === entryInput.normalizedUrl,
        );
        if (dup) {
          return {
            status: 'duplicate',
            stockNames: [existing.name],
            primaryStockId: existing.id,
            duplicateReason: dup.date ? `이미 등록됨 (${dup.date})` : '이미 등록된 URL',
          };
        }

        const newEntry: NewsEntry = {
          ...entryInput,
          id: createId('news'),
          addedAt: nowIso,
        };
        setStocks((prev) =>
          prev.map((s) =>
            s.id === existing.id
              ? {
                  ...s,
                  news: [...s.news, newEntry].sort((a, b) =>
                    compareNewsDates(a.date, b.date, 'asc'),
                  ),
                  updatedAt: nowIso,
                }
              : s,
          ),
        );
        setSelectedStockId(existing.id);
        return {
          status: 'saved',
          stockNames: [existing.name],
          primaryStockId: existing.id,
        };
      }

      const createdId = createId('stk');
      const newEntry: NewsEntry = {
        ...entryInput,
        id: createId('news'),
        addedAt: nowIso,
      };
      const createdStock: StockItem = {
        id: createdId,
        name: parsed.name,
        ticker: parsed.ticker,
        market: parsed.market,
        sector: parsed.sector,
        aliases: [],
        summaryNote: '',
        news: [newEntry],
        updatedAt: nowIso,
      };
      setStocks((prev) => [createdStock, ...prev]);
      setSelectedStockId(createdId);
      return {
        status: 'saved',
        stockNames: [createdStock.name],
        primaryStockId: createdId,
      };
    }

    const requestedIds = Array.from(new Set(options.targetStockIds.filter(Boolean)));
    if (requestedIds.length > 0) {
      const targetStocks = requestedIds
        .map((id) => stocks.find((s) => s.id === id))
        .filter((s): s is StockItem => Boolean(s));

      const nonDuplicateIds: string[] = [];
      const nonDuplicateNames: string[] = [];
      let firstDupDate = '';

      for (const t of targetStocks) {
        const dup = entryInput.normalizedUrl
          ? t.news.find((n) => n.normalizedUrl === entryInput.normalizedUrl)
          : undefined;
        if (dup) {
          if (!firstDupDate && dup.date) firstDupDate = dup.date;
        } else {
          nonDuplicateIds.push(t.id);
          nonDuplicateNames.push(t.name);
        }
      }

      if (nonDuplicateIds.length === 0 && targetStocks.length > 0) {
        return {
          status: 'duplicate',
          stockNames: targetStocks.map((s) => s.name),
          primaryStockId: targetStocks[0].id,
          duplicateReason: firstDupDate ? `이미 등록됨 (${firstDupDate})` : '이미 등록된 URL',
        };
      }

      if (nonDuplicateIds.length > 0) {
        const targetSet = new Set(nonDuplicateIds);
        setStocks((prev) =>
          prev.map((s) => {
            if (!targetSet.has(s.id)) return s;
            if (
              entryInput.normalizedUrl &&
              s.news.some((n) => n.normalizedUrl === entryInput.normalizedUrl)
            ) {
              return s;
            }
            const newEntry: NewsEntry = {
              ...entryInput,
              id: createId('news'),
              addedAt: nowIso,
            };
            return {
              ...s,
              news: [...s.news, newEntry].sort((a, b) => compareNewsDates(a.date, b.date, 'asc')),
              updatedAt: nowIso,
            };
          }),
        );
        setSelectedStockId(nonDuplicateIds[0]);
        return {
          status: 'saved',
          stockNames: nonDuplicateNames,
          primaryStockId: nonDuplicateIds[0],
        };
      }
    }

    // Fallback to unclassified bucket
    const existingBucket = stocks.find((s) => isUnclassifiedStock(s));
    if (existingBucket) {
      const dup = entryInput.normalizedUrl
        ? existingBucket.news.find((n) => n.normalizedUrl === entryInput.normalizedUrl)
        : undefined;
      if (dup) {
        return {
          status: 'duplicate',
          stockNames: [existingBucket.name],
          primaryStockId: existingBucket.id,
          duplicateReason: dup.date ? `이미 등록됨 (${dup.date})` : '이미 등록된 URL',
        };
      }
      const newEntry: NewsEntry = {
        ...entryInput,
        id: createId('news'),
        addedAt: nowIso,
      };
      setStocks((prev) =>
        prev.map((s) =>
          s.id === existingBucket.id
            ? {
                ...s,
                news: [...s.news, newEntry].sort((a, b) =>
                  compareNewsDates(a.date, b.date, 'asc'),
                ),
                updatedAt: nowIso,
              }
            : s,
        ),
      );
      setSelectedStockId(existingBucket.id);
      return {
        status: 'saved',
        stockNames: [existingBucket.name],
        primaryStockId: existingBucket.id,
      };
    }

    const bucketId = createId('stk');
    const newEntry: NewsEntry = {
      ...entryInput,
      id: createId('news'),
      addedAt: nowIso,
    };
    const bucket: StockItem = {
      id: bucketId,
      name: UNCLASSIFIED_STOCK_NAME,
      ticker: '',
      market: '미분류',
      sector: '구분 필요',
      aliases: [],
      summaryNote:
        '문서나 링크에서 종목이 자동 구분되지 않은 뉴스 모음입니다. 원하는 종목으로 이동해 주세요.',
      news: [newEntry],
      updatedAt: nowIso,
    };
    setStocks((prev) => consolidateUnclassifiedStocks([...prev, bucket]));
    setSelectedStockId(bucketId);
    return {
      status: 'saved',
      stockNames: [UNCLASSIFIED_STOCK_NAME],
      primaryStockId: bucketId,
    };
  };

  const handleUpdateNewsEntry = (
    fromStockId: string,
    newsId: string,
    updates: {
      title: string;
      url: string;
      normalizedUrl: string;
      source: string;
      category?: NewsCategory;
    },
    autoMoveToStockIds: string[] = [],
  ) => {
    const nowIso = new Date().toISOString();
    const moveTargets = autoMoveToStockIds.filter((id) => id && id !== fromStockId);

    setStocks((prev) => {
      const sourceStock = prev.find((s) => s.id === fromStockId);
      if (!sourceStock) return prev;
      const original = sourceStock.news.find((n) => n.id === newsId);
      if (!original) return prev;

      const updatedItem: NewsEntry = {
        ...original,
        title: updates.title,
        url: updates.url,
        normalizedUrl: updates.normalizedUrl,
        source: updates.source,
        category: updates.category ?? original.category,
      };

      if (moveTargets.length === 0) {
        return prev.map((s) =>
          s.id === fromStockId
            ? {
                ...s,
                news: s.news.map((n) => (n.id === newsId ? updatedItem : n)),
                updatedAt: nowIso,
              }
            : s,
        );
      }

      const targetSet = new Set(moveTargets);
      const next = prev
        .map((s) => {
          if (s.id === fromStockId) {
            return {
              ...s,
              news: s.news.filter((n) => n.id !== newsId),
              updatedAt: nowIso,
            };
          }
          if (targetSet.has(s.id)) {
            if (
              updatedItem.normalizedUrl &&
              s.news.some((n) => n.normalizedUrl === updatedItem.normalizedUrl)
            ) {
              return s;
            }
            const clonedEntry: NewsEntry = {
              ...updatedItem,
              id: s.id === moveTargets[0] ? updatedItem.id : createId('news'),
            };
            return {
              ...s,
              news: [...s.news, clonedEntry].sort((a, b) =>
                compareNewsDates(a.date, b.date, 'asc'),
              ),
              updatedAt: nowIso,
            };
          }
          return s;
        })
        .filter((s) => !(isUnclassifiedStock(s) && s.news.length === 0));

      return consolidateUnclassifiedStocks(next);
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <TopNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenImport={() => setIsImportOpen(true)}
      />

      {activeTab === 'workspace' && (
        <div className="flex flex-1 flex-col lg:flex-row">
          <StockSidebar
            stocks={stocks}
            selectedStockId={selectedStockId}
            onSelectStock={setSelectedStockId}
            onOpenQuickJump={() => setIsQuickJumpOpen(true)}
            onSearchStockNews={handleSearchStockNews}
            onAddStock={handleAddStock}
            onDeleteStock={handleDeleteStock}
            onDeleteEmptyStocks={handleDeleteEmptyStocks}
            onClearAllStocks={handleClearAllStocks}
          />
          <StockWorkspace
            stock={selectedStock}
            allStocks={stocks}
            mdConfig={mdConfig}
            newsSearchRequest={newsSearchRequest}
            onCloseNewsSearch={() => setNewsSearchRequest(null)}
            onSearchStockNews={handleSearchStockNews}
            onAddNewsItems={handleAddNewsItemsToStock}
            onSaveQuickNews={handleSaveQuickNews}
            onUpdateNewsEntry={handleUpdateNewsEntry}
            onUpdateStock={handleUpdateStock}
            onMoveNews={handleMoveNews}
            onMoveNewsBulk={handleMoveNewsBulk}
            onMoveNewsMap={handleMoveNewsMap}
            onGoToMerge={() => setActiveTab('merge')}
            onOpenImport={() => setIsImportOpen(true)}
          />
        </div>
      )}

      {activeTab === 'merge' && (
        <main className="flex-1">
          <BatchMergeView stocks={stocks} onCommitMerge={handleCommitBatchMerge} />
        </main>
      )}

      {activeTab === 'master' && (
        <main className="flex-1">
          <MasterMarkdownView
            stocks={stocks}
            config={mdConfig}
            onChangeConfig={setMdConfig}
            onReplaceAllStocks={(nextStocks) => {
              setStocks(nextStocks);
              if (nextStocks[0]) setSelectedStockId(nextStocks[0].id);
            }}
          />
        </main>
      )}

      <ImportModal
        isOpen={isImportOpen}
        existingStocks={stocks}
        onClose={() => setIsImportOpen(false)}
        onImport={handleImportStocks}
        onClearAll={() => {
          setStocks([]);
          setSelectedStockId('');
        }}
      />

      <QuickJumpModal
        isOpen={isQuickJumpOpen}
        stocks={stocks}
        selectedStockId={selectedStockId}
        onClose={() => setIsQuickJumpOpen(false)}
        onSelectStock={(id) => {
          setSelectedStockId(id);
          setActiveTab('workspace');
        }}
        onSearchStockNews={handleSearchStockNews}
      />
    </div>
  );
}
