import {
  Check,
  ExternalLink,
  Globe,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LatestNewsSearchResult,
  NewsCategory,
  NewsSearchPeriod,
  NewsSearchRegion,
  StockItem,
} from '../types/stock';
import {
  checkDuplicateStatus,
  inferCategory,
  isInvalidStockHeading,
  isUnclassifiedStock,
  normalizeUrl,
} from '../utils/markdownEngine';

interface LatestNewsPanelProps {
  isOpen: boolean;
  stock: StockItem | undefined;
  initialQuery: string;
  requestId: number;
  onClose: () => void;
  onAddNewsItems: (
    items: Array<{
      title: string;
      url: string;
      date: string;
      source: string;
      category: NewsCategory;
    }>,
    targetStockId?: string,
    newStockName?: string,
  ) => number;
}

const PERIOD_OPTIONS: Array<{ id: NewsSearchPeriod; label: string }> = [
  { id: '30d', label: '30일' },
  { id: '1y', label: '1년' },
  { id: '2y', label: '2년' },
  { id: 'all', label: '전체' },
];

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function LatestNewsPanel({
  isOpen,
  stock,
  initialQuery,
  requestId,
  onClose,
  onAddNewsItems,
}: LatestNewsPanelProps) {
  const [queryInput, setQueryInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [period, setPeriod] = useState<NewsSearchPeriod>('30d');
  const [region, setRegion] = useState<NewsSearchRegion>('ko');
  const [results, setResults] = useState<LatestNewsSearchResult[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [addedNotice, setAddedNotice] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (q: string, nextPeriod: NewsSearchPeriod, nextRegion: NewsSearchRegion) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setErrorMsg('검색할 종목명이나 키워드를 입력하세요.');
        setResults([]);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setErrorMsg('');
      setAddedNotice('');
      setActiveQuery(trimmed);
      setSelectedUrls([]);

      try {
        const res = await fetch('/api/search-news', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            query: trimmed,
            period: nextPeriod,
            region: nextRegion,
            limit: nextPeriod === '30d' ? 50 : 80,
          }),
        });
        const data = (await res.json()) as {
          items?: LatestNewsSearchResult[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || '최신 뉴스를 불러오지 못했습니다.');
        }
        setResults(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setErrorMsg(
          err instanceof Error ? err.message : '최신 뉴스 검색 중 오류가 발생했습니다.',
        );
        setResults([]);
      } finally {
        if (abortRef.current === controller) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      return;
    }
    const baseQuery = (initialQuery || (stock && !isUnclassifiedStock(stock) ? stock.name : '')).trim();
    if (!baseQuery) return;
    const defaultRegion: NewsSearchRegion =
      stock?.market === '해외' && /^[A-Za-z0-9.\s-]+$/.test(baseQuery) ? 'en' : 'ko';
    setQueryInput(baseQuery);
    setRegion(defaultRegion);
    void runSearch(baseQuery, period, defaultRegion);
    // Intentionally triggered when panel opens or requestId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, requestId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const enrichedResults = useMemo(() => {
    const checkTarget = stock && !isUnclassifiedStock(stock) ? stock : undefined;
    return results.map((item) => {
      const normUrl = normalizeUrl(item.url);
      const category = inferCategory(item.title, item.url);
      const dup = checkTarget
        ? checkDuplicateStatus(item.title, normUrl, checkTarget)
        : { status: 'new' as const };
      return {
        ...item,
        category,
        duplicateStatus: dup.status,
        duplicateReason: dup.reason,
        isDuplicate: dup.status !== 'new',
      };
    });
  }, [results, stock]);

  const newItems = useMemo(
    () => enrichedResults.filter((item) => !item.isDuplicate),
    [enrichedResults],
  );

  const selectedSet = useMemo(() => new Set(selectedUrls), [selectedUrls]);
  const allNewSelected =
    newItems.length > 0 && newItems.every((item) => selectedSet.has(item.url));

  if (!isOpen) return null;

  const targetStock = stock && !isUnclassifiedStock(stock) ? stock : undefined;
  const candidateNewStockName =
    !targetStock && activeQuery && !isInvalidStockHeading(activeQuery) ? activeQuery : '';

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(queryInput, period, region);
  };

  const handleChangePeriod = (nextPeriod: NewsSearchPeriod) => {
    setPeriod(nextPeriod);
    if (queryInput.trim()) {
      void runSearch(queryInput, nextPeriod, region);
    }
  };

  const handleChangeRegion = (nextRegion: NewsSearchRegion) => {
    setRegion(nextRegion);
    if (queryInput.trim()) {
      void runSearch(queryInput, period, nextRegion);
    }
  };

  const toggleSelectUrl = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  const toggleSelectAllNew = () => {
    if (allNewSelected) {
      setSelectedUrls([]);
    } else {
      setSelectedUrls(newItems.map((item) => item.url));
    }
  };

  const handleAddSingle = (item: (typeof enrichedResults)[number]) => {
    const added = onAddNewsItems(
      [
        {
          title: item.title,
          url: item.url,
          date: item.date,
          source: item.source,
          category: item.category,
        },
      ],
      targetStock?.id,
      candidateNewStockName || undefined,
    );
    setSelectedUrls((prev) => prev.filter((u) => u !== item.url));
    if (added > 0) {
      const label = targetStock?.name || candidateNewStockName || '종목';
      setAddedNotice(`'${label}'에 뉴스 1건을 추가했습니다.`);
    }
  };

  const handleAddSelected = () => {
    const itemsToAdd = enrichedResults
      .filter((item) => selectedSet.has(item.url) && !item.isDuplicate)
      .map((item) => ({
        title: item.title,
        url: item.url,
        date: item.date,
        source: item.source,
        category: item.category,
      }));
    if (itemsToAdd.length === 0) return;

    const added = onAddNewsItems(
      itemsToAdd,
      targetStock?.id,
      candidateNewStockName || undefined,
    );
    setSelectedUrls([]);
    const label = targetStock?.name || candidateNewStockName || '종목';
    setAddedNotice(`'${label}'에 최신 뉴스 ${added}건을 추가했습니다.`);
  };

  return (
    <section className="border-b border-slate-800 bg-slate-900/90 px-6 py-4">
      <div className="rounded-xl border border-sky-500/30 bg-slate-950/75 overflow-hidden">
        {/* Panel Header & Search Bar */}
        <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15 text-sky-400">
                <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <h2 className="text-xs font-bold text-slate-100">
                최신 뉴스 실시간 검색
              </h2>
              <span className="text-[11px] text-slate-500">
                {region === 'ko' ? 'Google · 네이버 통합 (원문 링크 · 중복 제거)' : 'Google 글로벌 (원문 링크)'}
              </span>
              {activeQuery && !isLoading && (
                <span className="font-mono text-[11px] text-slate-400">
                  &lsquo;{activeQuery}&rsquo; {enrichedResults.length}건
                  {targetStock && newItems.length < enrichedResults.length
                    ? ` (미등록 ${newItems.length}건)`
                    : ''}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="최신 뉴스 검색 닫기"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>닫기</span>
            </button>
          </div>

          <form
            onSubmit={handleSubmitSearch}
            className="flex flex-col gap-2 lg:flex-row lg:items-center"
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="종목명 또는 키워드 (예: 삼성전자, 알테오젠, 엔비디아 HBM)"
                className="w-full rounded-lg border border-slate-700/80 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleChangePeriod(opt.id)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      period === opt.id
                        ? 'bg-slate-800 text-sky-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                <button
                  type="button"
                  onClick={() => handleChangeRegion('ko')}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    region === 'ko'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  국내
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeRegion('en')}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    region === 'en'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  <span>해외</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{isLoading ? '검색 중...' : '최신 뉴스 검색'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Bulk Action Bar */}
        {!isLoading && enrichedResults.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/40 px-4 py-2 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllNew}
                disabled={newItems.length === 0}
                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                {allNewSelected
                  ? '선택 해제'
                  : `미등록 기사 전체 선택 (${newItems.length}건)`}
              </button>
              {addedNotice && (
                <span className="font-medium text-emerald-400">{addedNotice}</span>
              )}
            </div>

            <button
              type="button"
              disabled={selectedUrls.length === 0}
              onClick={handleAddSelected}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {targetStock
                  ? `'${targetStock.name}'에 선택 ${selectedUrls.length}건 추가`
                  : candidateNewStockName
                    ? `'${candidateNewStockName}' 종목 등록 후 ${selectedUrls.length}건 추가`
                    : `선택 ${selectedUrls.length}건 추가`}
              </span>
            </button>
          </div>
        )}

        {/* Results Body */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" aria-hidden="true" />
            <span>&lsquo;{activeQuery || queryInput}&rsquo; 최신 뉴스를 불러오는 중...</span>
          </div>
        ) : errorMsg ? (
          <div className="px-4 py-6 text-center text-xs text-rose-300">{errorMsg}</div>
        ) : enrichedResults.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            검색 기간을 &lsquo;전체&rsquo;로 넓히거나 다른 검색어로 다시 시도해보세요.
          </div>
        ) : (
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-800/70 sidebar-scrollbar">
            {enrichedResults.map((item) => {
              const isChecked = selectedSet.has(item.url);
              const safeHref = isSafeHttpUrl(item.url) ? item.url : '#';
              return (
                <div
                  key={item.url}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${
                    item.isDuplicate
                      ? 'bg-slate-900/30 opacity-65'
                      : isChecked
                        ? 'bg-sky-500/10'
                        : 'hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={item.isDuplicate}
                      onChange={() => toggleSelectUrl(item.url)}
                      aria-label={`${item.title} 선택`}
                      className="mt-1 h-4 w-4 accent-sky-400 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span className="font-mono tabular-nums text-slate-300">
                          {item.date || '날짜 미상'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.source}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-300/90">{item.category}</span>
                        {item.providers && item.providers.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[10px] text-slate-500">
                              {item.providers
                                .map((p) => (p === 'google' ? 'Google' : '네이버'))
                                .join(' + ')}
                            </span>
                          </>
                        )}
                        {item.isDuplicate && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            <Check className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{item.duplicateReason || '이미 등록됨'}</span>
                          </span>
                        )}
                      </div>
                      <a
                        href={safeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-baseline gap-1.5 text-xs font-semibold text-slate-100 hover:text-sky-300 hover:underline break-words"
                      >
                        <span>{item.title}</span>
                        <ExternalLink
                          className="h-3 w-3 shrink-0 text-slate-500"
                          aria-hidden="true"
                        />
                      </a>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {item.isDuplicate ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">
                        <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                        <span>등록됨</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddSingle(item)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-sky-300 hover:border-sky-500/60 hover:bg-sky-950/50 whitespace-nowrap"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        <span>추가</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
