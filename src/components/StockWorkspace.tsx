import {
  ArrowRight,
  CalendarClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  Link2,
  Loader2,
  Newspaper,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MarkdownFormatConfig,
  MarketType,
  NewsCategory,
  NewsEntry,
  QuickNewsSaveResult,
  StockItem,
} from '../types/stock';
import {
  NEWS_CATEGORIES,
  analyzeStockMatchesInText,
  compareNewsDates,
  compileStockForTelegram,
  compileStockToMarkdown,
  extractDateFromContent,
  extractDomainLabel,
  getTodayDate,
  inferCategory,
  isMissingOrGenericTitle,
  isUnclassifiedStock,
  matchStockInText,
  normalizeUrl,
  parseMarkdownToStocks,
  stripDecorativeDividers,
} from '../utils/markdownEngine';
import { LatestNewsPanel } from './LatestNewsPanel';
import { SearchableStockPicker } from './SearchableStockPicker';

interface StockWorkspaceProps {
  stock: StockItem | undefined;
  allStocks: StockItem[];
  mdConfig: MarkdownFormatConfig;
  newsSearchRequest: {
    id: number;
    query: string;
    targetStockId?: string;
  } | null;
  onCloseNewsSearch: () => void;
  onSearchStockNews: (query: string, stockId?: string) => void;
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
  onSaveQuickNews: (
    entryInput: Omit<NewsEntry, 'id' | 'addedAt'>,
    options: { targetStockIds: string[]; newStockName?: string },
  ) => QuickNewsSaveResult;
  onUpdateNewsEntry: (
    fromStockId: string,
    newsId: string,
    updates: {
      title: string;
      url: string;
      normalizedUrl: string;
      source: string;
      category?: NewsCategory;
    },
    autoMoveToStockIds?: string[],
  ) => void;
  onUpdateStock: (updated: StockItem) => void;
  onMoveNews: (newsId: string, fromStockId: string, toStockId: string) => void;
  onMoveNewsBulk: (
    newsIds: string[],
    fromStockId: string,
    toStockId: string,
    newStockName?: string,
  ) => void;
  onMoveNewsMap: (moves: Array<{ newsId: string; toStockId: string }>, fromStockId: string) => void;
  onGoToMerge: () => void;
  onOpenImport: () => void;
}

type ViewMode = 'timeline' | 'markdown' | 'split';

const CATEGORY_TEXT_COLORS: Record<NewsCategory, string> = {
  '실적/가이던스': 'text-sky-400',
  '공시/지분': 'text-amber-300',
  '수주/계약': 'text-emerald-400',
  '신사업/R&D': 'text-cyan-300',
  주주환원: 'text-rose-300',
  '업황/리포트': 'text-violet-300',
  일반: 'text-slate-400',
};

const CATEGORY_BAR_COLORS: Record<NewsCategory, string> = {
  '실적/가이던스': 'bg-sky-400',
  '공시/지분': 'bg-amber-400',
  '수주/계약': 'bg-emerald-400',
  '신사업/R&D': 'bg-cyan-400',
  주주환원: 'bg-rose-400',
  '업황/리포트': 'bg-violet-400',
  일반: 'bg-slate-600',
};

function normalizeDirectHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme =
    /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(trimmed)
        ? `https://${trimmed}`
        : '';
  if (!withScheme) return '';
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function StockWorkspace({
  stock,
  allStocks,
  mdConfig,
  newsSearchRequest,
  onCloseNewsSearch,
  onSearchStockNews,
  onAddNewsItems,
  onSaveQuickNews,
  onUpdateNewsEntry,
  onUpdateStock,
  onMoveNews,
  onMoveNewsBulk,
  onMoveNewsMap,
  onGoToMerge,
  onOpenImport,
}: StockWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'전체' | NewsCategory>('전체');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('asc');
  const [copied, setCopied] = useState(false);
  const [copiedTelegram, setCopiedTelegram] = useState(false);
  const [isSyncingDates, setIsSyncingDates] = useState(false);
  const [dateSyncNotice, setDateSyncNotice] = useState('');
  const [emptyNewsQuery, setEmptyNewsQuery] = useState('');

  // Classification & bulk move state
  const [isClassifyMode, setIsClassifyMode] = useState(false);
  const [selectedNewsIds, setSelectedNewsIds] = useState<string[]>([]);
  const [bulkTargetStockId, setBulkTargetStockId] = useState('');
  const [bulkNewStockName, setBulkNewStockName] = useState('');

  // Quick add news state
  const [quickInput, setQuickInput] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDate, setQuickDate] = useState('');
  const [quickCategory, setQuickCategory] = useState<NewsCategory>('일반');
  const [quickMemo, setQuickMemo] = useState('');
  const [quickTargetStockId, setQuickTargetStockId] = useState('');
  const [quickNewStockName, setQuickNewStockName] = useState('');
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isSavingQuick, setIsSavingQuick] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [quickSuccess, setQuickSuccess] = useState('');
  const quickSuccessTimerRef = useRef<number | null>(null);

  // Editable raw markdown state
  const [editableMd, setEditableMd] = useState('');
  const [mdAppliedNotice, setMdAppliedNotice] = useState(false);

  // Inline editing of stock metadata
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTicker, setEditTicker] = useState('');
  const [editMarket, setEditMarket] = useState<MarketType>('KOSPI');
  const [editSector, setEditSector] = useState('');
  const [editAliases, setEditAliases] = useState('');
  const [editSummary, setEditSummary] = useState('');

  // Inline editing of an existing news item's title & hyperlink
  const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
  const [editNewsTitle, setEditNewsTitle] = useState('');
  const [editNewsUrl, setEditNewsUrl] = useState('');
  const [editNewsError, setEditNewsError] = useState('');

  const compiledMarkdown = stock ? compileStockToMarkdown(stock, mdConfig) : '';

  useEffect(() => {
    setEditableMd(compiledMarkdown);
  }, [compiledMarkdown, stock?.id]);

  useEffect(() => {
    if (stock) {
      setEditName(stock.name);
      setEditTicker(stock.ticker);
      setEditMarket(stock.market);
      setEditSector(stock.sector);
      setEditAliases(stock.aliases.join(', '));
      setEditSummary(stock.summaryNote);
      setIsEditingHeader(false);
      setEditingNewsId(null);
      setEditNewsError('');
      setQuickError('');
      setSelectedNewsIds([]);
      setBulkTargetStockId('');
      setBulkNewStockName('');
      setIsClassifyMode(isUnclassifiedStock(stock));
    }
  }, [stock?.id]);

  const stockStats = useMemo(() => {
    if (!stock || stock.news.length === 0) {
      return {
        earliest: '',
        latest: '',
        undatedCount: 0,
        categoryCounts: [] as Array<{ category: NewsCategory; count: number; pct: number }>,
        topSources: [] as Array<{ source: string; count: number }>,
      };
    }
    let earliest = '';
    let latest = '';
    let undatedCount = 0;
    const catMap = new Map<NewsCategory, number>();
    const sourceMap = new Map<string, number>();

    for (const item of stock.news) {
      if (item.date) {
        if (!earliest || item.date < earliest) earliest = item.date;
        if (!latest || item.date > latest) latest = item.date;
      } else {
        undatedCount++;
      }
      catMap.set(item.category, (catMap.get(item.category) ?? 0) + 1);
      if (item.source) {
        sourceMap.set(item.source, (sourceMap.get(item.source) ?? 0) + 1);
      }
    }

    const total = stock.news.length;
    const categoryCounts = NEWS_CATEGORIES.map((category) => {
      const count = catMap.get(category) ?? 0;
      return { category, count, pct: (count / total) * 100 };
    }).filter((x) => x.count > 0);

    const topSources = Array.from(sourceMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([source, count]) => ({ source, count }));

    return { earliest, latest, undatedCount, categoryCounts, topSources };
  }, [stock]);

  useEffect(() => {
    return () => {
      if (quickSuccessTimerRef.current) {
        window.clearTimeout(quickSuccessTimerRef.current);
      }
    };
  }, []);

  const showQuickSuccess = (msg: string) => {
    if (quickSuccessTimerRef.current) {
      window.clearTimeout(quickSuccessTimerRef.current);
    }
    setQuickSuccess(msg);
    quickSuccessTimerRef.current = window.setTimeout(() => {
      setQuickSuccess('');
      quickSuccessTimerRef.current = null;
    }, 4500);
  };

  const allRegularStocks = useMemo(
    () => allStocks.filter((s) => !isUnclassifiedStock(s)),
    [allStocks],
  );

  const parseQuickUrlAndTitle = (raw: string): { url: string; title: string } => {
    const trimmed = raw.trim();
    const mdMatch =
      trimmed.match(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^)\s]+)\)/) ||
      trimmed.match(/\[(.*?)\]\((https?:\/\/[^)\s]+)\)/);
    if (mdMatch) {
      return { title: mdMatch[1].trim(), url: normalizeDirectHttpUrl(mdMatch[2]) };
    }
    const urlMatch = trimmed.match(/(https?:\/\/\S+)/);
    if (urlMatch) {
      const url = normalizeDirectHttpUrl(urlMatch[1]);
      const leftover = trimmed.replace(urlMatch[1], '').trim();
      return { title: leftover, url };
    }
    const bareUrl = normalizeDirectHttpUrl(trimmed);
    if (bareUrl) {
      return { title: '', url: bareUrl };
    }
    return { title: trimmed, url: '' };
  };

  const liveQuickPreview = useMemo(() => {
    const parsedFromUrlBox = parseQuickUrlAndTitle(quickInput);
    const parsedFromTitleBox = parseQuickUrlAndTitle(quickTitle);
    const titleCandidate =
      (parsedFromTitleBox.url ? parsedFromTitleBox.title : quickTitle.trim()) ||
      parsedFromUrlBox.title;
    const textForMatch = stripDecorativeDividers(`${titleCandidate} ${quickMemo}`);
    const matched = textForMatch
      ? analyzeStockMatchesInText(textForMatch, allRegularStocks).matched
      : [];
    return { matched, hasTitle: Boolean(titleCandidate.trim()) };
  }, [quickTitle, quickInput, quickMemo, allRegularStocks]);

  const handleFetchQuickTitle = async () => {
    const { url } = parseQuickUrlAndTitle(quickInput);
    if (!url) {
      setQuickError('제목을 가져올 하이퍼링크(URL)를 먼저 입력하세요.');
      return;
    }
    setQuickError('');
    setQuickSuccess('');
    setIsFetchingMeta(true);
    try {
      const res = await fetch('/api/fetch-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      });
      const data = (await res.json()) as {
        results?: Record<string, { title?: string; date?: string; error?: string }>;
      };
      const meta = data.results?.[url];
      if (meta?.title || meta?.date) {
        if (meta.title) {
          setQuickTitle(meta.title);
          setQuickCategory(inferCategory(meta.title, url));
        }
        const detected =
          meta.date || (meta.title ? extractDateFromContent(meta.title, url) : undefined);
        if (detected) setQuickDate(detected);
      } else {
        setQuickError(meta?.error || '기사 제목을 가져오지 못했습니다. 직접 입력해주세요.');
      }
    } catch {
      setQuickError('링크 조회 중 오류가 발생했습니다.');
    } finally {
      setIsFetchingMeta(false);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickError('');
    setQuickSuccess('');

    const parsedFromUrlBox = parseQuickUrlAndTitle(quickInput);
    const parsedFromTitleBox = parseQuickUrlAndTitle(quickTitle);
    const finalUrl = parsedFromUrlBox.url || parsedFromTitleBox.url;
    let rawTitle =
      (parsedFromTitleBox.url ? parsedFromTitleBox.title : quickTitle.trim()) ||
      parsedFromUrlBox.title;
    let resolvedDate = quickDate.trim();
    let titleFetchedFromUrl = false;

    if (!finalUrl) {
      setQuickError('유효한 하이퍼링크(https://... 또는 도메인/주소)를 입력하세요.');
      return;
    }

    if (!stripDecorativeDividers(rawTitle)) {
      setIsSavingQuick(true);
      try {
        const res = await fetch('/api/fetch-meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: [finalUrl] }),
        });
        const data = (await res.json()) as {
          results?: Record<string, { title?: string; date?: string }>;
        };
        const meta = data.results?.[finalUrl];
        if (meta?.title) {
          rawTitle = meta.title;
          titleFetchedFromUrl = true;
        }
        if (!resolvedDate) {
          resolvedDate =
            meta?.date ||
            (meta?.title ? extractDateFromContent(meta.title, finalUrl) || '' : '');
        }
      } catch {
        // Fallback to URL as title if meta fetch fails
      } finally {
        setIsSavingQuick(false);
      }
    }

    const finalTitle = stripDecorativeDividers(rawTitle) || finalUrl;
    const cleanedMemo = stripDecorativeDividers(quickMemo);
    if (!resolvedDate) {
      resolvedDate =
        extractDateFromContent(`${quickInput} ${finalTitle} ${cleanedMemo}`, finalUrl) || '';
    }

    const normUrl = normalizeUrl(finalUrl);
    const finalCat = quickCategory === '일반' ? inferCategory(finalTitle, finalUrl) : quickCategory;

    let targetStockIds: string[] = [];
    let newStockName = '';
    let usedAutoMatch = false;
    let fellBackToCurrent = false;

    if (quickNewStockName.trim()) {
      newStockName = quickNewStockName.trim();
    } else if (quickTargetStockId) {
      targetStockIds = [quickTargetStockId];
    } else {
      const matched = analyzeStockMatchesInText(
        `${finalTitle} ${cleanedMemo}`,
        allRegularStocks,
      ).matched;
      if (matched.length > 0) {
        targetStockIds = matched.map((s) => s.id);
        usedAutoMatch = true;
      } else if (stock && !isUnclassifiedStock(stock)) {
        targetStockIds = [stock.id];
        fellBackToCurrent = true;
      }
    }

    const result = onSaveQuickNews(
      {
        title: finalTitle,
        url: finalUrl,
        normalizedUrl: normUrl,
        date: resolvedDate,
        source: extractDomainLabel(finalUrl),
        category: finalCat,
        memo: cleanedMemo,
      },
      {
        targetStockIds,
        newStockName: newStockName || undefined,
      },
    );

    if (result.status === 'duplicate') {
      setQuickError(
        `이미 '${result.stockNames.join(', ')}'에 등록된 URL입니다 (${result.duplicateReason || '중복 링크'}).`,
      );
      return;
    }

    setQuickInput('');
    setQuickTitle('');
    setQuickMemo('');
    setQuickDate('');
    setQuickCategory('일반');
    setQuickTargetStockId('');
    setQuickNewStockName('');

    const targetLabel = result.stockNames.join(', ');
    if (usedAutoMatch) {
      showQuickSuccess(
        titleFetchedFromUrl
          ? `링크 제목을 추출해 '${targetLabel}' 종목을 자동으로 찾아 저장했습니다.`
          : `'${targetLabel}' 종목을 자동으로 찾아 저장했습니다.`,
      );
    } else if (fellBackToCurrent || quickTargetStockId || newStockName) {
      showQuickSuccess(`'${targetLabel}'에 저장했습니다.`);
    } else {
      showQuickSuccess(
        `일치하는 등록 종목이 없어 '${targetLabel}'에 저장했습니다.`,
      );
    }
  };

  const manualSelectedTarget = quickTargetStockId
    ? allRegularStocks.find((s) => s.id === quickTargetStockId)
    : undefined;

  const quickAddSection = (
    <section className="border-b border-slate-800 bg-slate-900/70 px-6 py-4">
      <form onSubmit={handleQuickAdd} className="space-y-2.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => {
              const val = e.target.value;
              const mdMatch = val.match(/^\s*\[((?:[^\[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^)\s]+)\)\s*$/);
              if (mdMatch) {
                setQuickTitle(mdMatch[1].trim());
                setQuickInput(mdMatch[2].trim());
              } else {
                setQuickTitle(val);
              }
            }}
            placeholder="기사 제목 직접 입력 (비워두면 링크에서 자동 추출)"
            aria-label="기사 제목"
            className="lg:w-72 rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
          />

          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="text"
              value={quickInput}
              onChange={(e) => {
                const val = e.target.value;
                const mdMatch = val.match(/^\s*\[((?:[^\[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^)\s]+)\)\s*$/);
                if (mdMatch && !quickTitle.trim()) {
                  setQuickTitle(mdMatch[1].trim());
                  setQuickInput(mdMatch[2].trim());
                } else {
                  setQuickInput(val);
                }
              }}
              placeholder="하이퍼링크 URL 입력 (https://... 또는 [제목](URL))"
              aria-label="하이퍼링크 URL"
              className="w-full rounded-lg border border-slate-700/80 bg-slate-950/70 py-2 pl-9 pr-28 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleFetchQuickTitle}
              disabled={isFetchingMeta || isSavingQuick}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md bg-slate-800 border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap"
            >
              {isFetchingMeta ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  <span>조회중</span>
                </>
              ) : (
                <span>제목 가져오기</span>
              )}
            </button>
          </div>

          <input
            type="date"
            value={quickDate}
            onChange={(e) => setQuickDate(e.target.value)}
            className="rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-2 font-mono text-xs text-slate-100 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
          />

          <select
            value={quickCategory}
            onChange={(e) => setQuickCategory(e.target.value as NewsCategory)}
            className="rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-2 text-xs text-slate-100 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
          >
            {NEWS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={isSavingQuick || isFetchingMeta}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isSavingQuick ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>저장 중...</span>
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>저장</span>
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <input
              type="text"
              value={quickMemo}
              onChange={(e) => setQuickMemo(e.target.value)}
              placeholder="선택 메모 (예: 4분기 컨센서스 상향 포인트)"
              className="w-full max-w-xs rounded-md border border-transparent bg-slate-950/50 px-2.5 py-1 text-xs text-slate-300 placeholder:text-slate-500 focus:border-slate-700 focus:bg-slate-950 focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <SearchableStockPicker
                stocks={allRegularStocks}
                selectedStockId={quickTargetStockId}
                selectedNewStockName={quickNewStockName}
                showSelectedLabel={true}
                placeholder="저장 종목: 자동 찾기"
                clearLabel="자동 찾기로 되돌리기"
                buttonClassName="text-[11px] py-1 px-2.5 border-slate-700/80 bg-slate-950/60"
                onSelectStock={(id) => {
                  setQuickTargetStockId(id);
                  setQuickNewStockName('');
                }}
                onSelectNewStock={(name) => {
                  setQuickTargetStockId('');
                  setQuickNewStockName(name);
                }}
                onClear={() => {
                  setQuickTargetStockId('');
                  setQuickNewStockName('');
                }}
              />

              {quickNewStockName.trim() ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  <span>새 종목 &lsquo;{quickNewStockName.trim()}&rsquo;에 저장</span>
                </span>
              ) : manualSelectedTarget ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span>지정 종목 &lsquo;{manualSelectedTarget.name}&rsquo;에 저장</span>
                </span>
              ) : liveQuickPreview.matched.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  <span>
                    자동 매칭: {liveQuickPreview.matched.map((s) => s.name).join(', ')}
                  </span>
                </span>
              ) : liveQuickPreview.hasTitle ? (
                <span className="text-[11px] text-slate-400">
                  {stock && !isUnclassifiedStock(stock)
                    ? `제목 내 타 종목 미감지 → '${stock.name}'에 저장`
                    : "일치 종목 없음 → '미분류 뉴스'에 저장"}
                </span>
              ) : quickInput.trim() ? (
                <span className="text-[11px] text-slate-400">
                  저장 시 링크에서 제목을 추출해 종목을 자동 매칭합니다
                </span>
              ) : null}
            </div>
          </div>

          {quickError && (
            <span className="text-xs font-medium text-rose-400">{quickError}</span>
          )}
          {!quickError && quickSuccess && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{quickSuccess}</span>
            </span>
          )}
        </div>
      </form>
    </section>
  );

  if (!stock) {
    return (
      <div className="flex flex-1 flex-col min-w-0 bg-slate-950">
        {quickAddSection}

        {newsSearchRequest && (
          <LatestNewsPanel
            isOpen={true}
            stock={undefined}
            initialQuery={newsSearchRequest.query}
            requestId={newsSearchRequest.id}
            onClose={onCloseNewsSearch}
            onAddNewsItems={onAddNewsItems}
          />
        )}

        <div className="flex flex-1 flex-col items-center justify-center p-8 lg:p-14 text-center bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.08),_transparent_60%)]">
          <div className="max-w-2xl w-full">
            <h2 className="text-xl font-bold tracking-tight text-slate-50">
              상장사 뉴스 아카이브 시작하기
            </h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              기존에 모아둔 `.md` 파일이나 Word(`.docx`) 뉴스 문서를 불러오면 종목별로 자동 정리되고,
              중복 링크를 걸러낸 뒤 텔레그램 봇용 통합 파일로 바로 내보낼 수 있습니다.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!emptyNewsQuery.trim()) return;
                onSearchStockNews(emptyNewsQuery.trim());
              }}
              className="mt-6 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-2 max-w-lg mx-auto"
            >
              <Search className="ml-2 h-4 w-4 text-sky-400 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={emptyNewsQuery}
                onChange={(e) => setEmptyNewsQuery(e.target.value)}
                placeholder="종목명을 입력해 바로 최신 뉴스 검색 (예: 삼성전자)"
                className="flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!emptyNewsQuery.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 whitespace-nowrap"
              >
                <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
                <span>최신 뉴스 검색</span>
              </button>
            </form>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/75 text-left">
              <div className="p-4">
                <div className="font-mono text-xs font-semibold text-sky-400">01</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">원본 불러오기</div>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  기존 `종목뉴스_전체.md`나 `.docx` 파일을 올려 한 번에 복원합니다.
                </p>
              </div>
              <div className="p-4">
                <div className="font-mono text-xs font-semibold text-sky-400">02</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">일괄 병합·중복 제거</div>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  신규 뉴스 문서를 올리면 종목을 자동 매칭하고 날짜순으로 합칩니다.
                </p>
              </div>
              <div className="p-4">
                <div className="font-mono text-xs font-semibold text-sky-400">03</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">통합 .md 내보내기</div>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  텔레그램 검색 봇 규격 그대로 `종목뉴스_전체.md`로 저장합니다.
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenImport}
                className="rounded-lg bg-sky-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors"
              >
                .doc / .md 파일 불러오기
              </button>
              <button
                type="button"
                onClick={onGoToMerge}
                className="rounded-lg border border-slate-700 bg-slate-900 px-5 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
              >
                뉴스 일괄 병합하기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isUnclassified = isUnclassifiedStock(stock);
  const regularTargetStocks = allStocks.filter((s) => !isUnclassifiedStock(s) && s.id !== stock.id);
  const classifyActive = isUnclassified || isClassifyMode;

  const filteredNews = stock.news
    .filter((n) => {
      const matchesCat = categoryFilter === '전체' || n.category === categoryFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        n.title.toLowerCase().includes(q) ||
        n.memo.toLowerCase().includes(q) ||
        n.source.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    })
    .sort((a, b) => compareNewsDates(a.date, b.date, sortOrder));

  const autoMatchMoves = filteredNews
    .map((item) => {
      const matched = matchStockInText(`${item.title} ${item.memo}`, regularTargetStocks);
      return matched ? { newsId: item.id, toStockId: matched.id } : null;
    })
    .filter((x): x is { newsId: string; toStockId: string } => x !== null);

  const visibleSelectedSet = new Set(selectedNewsIds);
  const allFilteredSelected =
    filteredNews.length > 0 && filteredNews.every((n) => visibleSelectedSet.has(n.id));

  const toggleSelectNews = (newsId: string) => {
    setSelectedNewsIds((prev) =>
      prev.includes(newsId) ? prev.filter((id) => id !== newsId) : [...prev, newsId],
    );
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredNews.map((n) => n.id);
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredIds);
      setSelectedNewsIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      setSelectedNewsIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleApplyBulkMove = () => {
    if (selectedNewsIds.length === 0) return;
    if (bulkNewStockName.trim()) {
      onMoveNewsBulk(selectedNewsIds, stock.id, '', bulkNewStockName.trim());
      setBulkNewStockName('');
      setBulkTargetStockId('');
      setSelectedNewsIds([]);
      return;
    }
    if (!bulkTargetStockId) return;
    onMoveNewsBulk(selectedNewsIds, stock.id, bulkTargetStockId);
    setSelectedNewsIds([]);
  };

  const handleCopyMarkdown = async () => {
    await navigator.clipboard.writeText(compiledMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleCopyTelegram = async () => {
    const tgText = compileStockForTelegram(stock, mdConfig);
    await navigator.clipboard.writeText(tgText);
    setCopiedTelegram(true);
    setTimeout(() => setCopiedTelegram(false), 1800);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([compiledMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileLabel = stock.ticker ? `${stock.name}_${stock.ticker}` : stock.name;
    a.download = `${fileLabel}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Quick-add handlers are defined above before early return

  const handleSyncStockDates = async () => {
    if (!stock || stock.news.length === 0) return;
    setIsSyncingDates(true);
    setDateSyncNotice('');
    try {
      const today = getTodayDate();
      let updatedCount = 0;

      // 1. Local content/URL date & memo-to-title promotion first
      const needsRemoteDate = new Set<string>();
      const stage1 = stock.news.map((n) => {
        let next = n;
        let rowChanged = false;
        if (isMissingOrGenericTitle(next.title, next.url) && next.memo.trim()) {
          const promotedTitle = next.memo.trim();
          next = {
            ...next,
            title: promotedTitle,
            memo: '',
            category: next.category === '일반' ? inferCategory(promotedTitle, next.url) : next.category,
          };
          rowChanged = true;
        }
        const detected = extractDateFromContent(`${next.title} ${next.memo}`, next.url, next.date);
        if (detected) {
          if (detected !== next.date) {
            next = { ...next, date: detected };
            rowChanged = true;
          }
        } else {
          needsRemoteDate.add(next.id);
        }
        if (rowChanged) updatedCount++;
        return next;
      });

      // 2. Fetch titles and publish dates from URLs for items missing title or date
      const urlsToFetch = Array.from(
        new Set(
          stage1
            .filter(
              (n) =>
                !n.date ||
                needsRemoteDate.has(n.id) ||
                n.date === today ||
                isMissingOrGenericTitle(n.title, n.url),
            )
            .map((n) => n.url),
        ),
      );
      const fetchedResults: Record<string, { title?: string; date?: string }> = {};

      for (let i = 0; i < urlsToFetch.length; i += 50) {
        const batch = urlsToFetch.slice(i, i + 50);
        try {
          const res = await fetch('/api/fetch-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: batch }),
          });
          const data = (await res.json()) as {
            results?: Record<string, { title?: string; date?: string }>;
          };
          Object.assign(fetchedResults, data.results || {});
        } catch {
          // ignore network errors per batch
        }
      }

      const stage2 = stage1
        .map((n) => {
          const meta = fetchedResults[n.url];
          let next = n;
          let rowChanged = false;

          if (meta) {
            if (isMissingOrGenericTitle(next.title, next.url) && meta.title) {
              const nextCategory =
                next.category === '일반' ? inferCategory(meta.title, next.url) : next.category;
              next = { ...next, title: meta.title, category: nextCategory };
              rowChanged = true;
            }
            const nextDate =
              meta.date ||
              (meta.title ? extractDateFromContent(meta.title, next.url) : undefined);
            if (nextDate && nextDate !== next.date) {
              next = { ...next, date: nextDate };
              rowChanged = true;
            }
          }
          // If still stamped as today's placeholder without confirmation, clear it rather than showing fake today
          if (next.date === today && needsRemoteDate.has(next.id) && !meta?.date) {
            next = { ...next, date: '' };
            rowChanged = true;
          }
          if (rowChanged) updatedCount++;
          return next;
        })
        .sort((a, b) => compareNewsDates(a.date, b.date, 'asc'));

      onUpdateStock({
        ...stock,
        news: stage2,
        updatedAt: new Date().toISOString(),
      });
      setSortOrder('asc');
      setDateSyncNotice(
        updatedCount > 0 ? `${updatedCount}건 제목·날짜 반영·정렬됨` : '빠른순 정렬 완료',
      );
      setTimeout(() => setDateSyncNotice(''), 2500);
    } finally {
      setIsSyncingDates(false);
    }
  };

  const handleDeleteNews = (newsId: string) => {
    onUpdateStock({
      ...stock,
      news: stock.news.filter((n) => n.id !== newsId),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateNewsMemo = (newsId: string, memo: string) => {
    onUpdateStock({
      ...stock,
      news: stock.news.map((n) => (n.id === newsId ? { ...n, memo } : n)),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateNewsCategory = (newsId: string, category: NewsCategory) => {
    onUpdateStock({
      ...stock,
      news: stock.news.map((n) => (n.id === newsId ? { ...n, category } : n)),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateNewsDate = (newsId: string, date: string) => {
    onUpdateStock({
      ...stock,
      news: stock.news.map((n) => (n.id === newsId ? { ...n, date } : n)),
      updatedAt: new Date().toISOString(),
    });
  };

  const startEditingNews = (item: NewsEntry) => {
    setEditingNewsId(item.id);
    setEditNewsTitle(item.title);
    setEditNewsUrl(item.url);
    setEditNewsError('');
  };

  const cancelEditingNews = () => {
    setEditingNewsId(null);
    setEditNewsError('');
  };

  const handleSaveEditedNews = (newsId: string) => {
    const cleanTitle = stripDecorativeDividers(editNewsTitle);
    const cleanUrl = normalizeDirectHttpUrl(editNewsUrl);
    if (!cleanTitle) {
      setEditNewsError('기사 제목을 입력하세요.');
      return;
    }
    if (!cleanUrl) {
      setEditNewsError('유효한 http(s) 하이퍼링크를 입력하세요.');
      return;
    }
    const existing = stock.news.find((n) => n.id === newsId);
    const nextNormUrl = normalizeUrl(cleanUrl);
    const nextCategory =
      existing && existing.category === '일반'
        ? inferCategory(cleanTitle, cleanUrl)
        : existing?.category;
    const nextSource =
      existing && existing.url === cleanUrl
        ? existing.source
        : extractDomainLabel(cleanUrl);

    const autoMoveTargets = isUnclassified
      ? analyzeStockMatchesInText(
          `${cleanTitle} ${existing?.memo || ''}`,
          regularTargetStocks,
        ).matched
      : [];

    onUpdateNewsEntry(
      stock.id,
      newsId,
      {
        title: cleanTitle,
        url: cleanUrl,
        normalizedUrl: nextNormUrl,
        source: nextSource,
        category: nextCategory,
      },
      autoMoveTargets.map((s) => s.id),
    );

    if (autoMoveTargets.length > 0) {
      showQuickSuccess(
        `'${autoMoveTargets.map((s) => s.name).join(', ')}' 종목으로 자동 찾아 이동·저장했습니다.`,
      );
    }

    setEditingNewsId(null);
    setEditNewsError('');
  };

  const handleSaveHeader = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    onUpdateStock({
      ...stock,
      name: editName.trim(),
      ticker: editTicker.trim().toUpperCase(),
      market: editMarket,
      sector: editSector.trim(),
      aliases: editAliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      summaryNote: editSummary.trim(),
      updatedAt: new Date().toISOString(),
    });
    setIsEditingHeader(false);
  };

  const handleApplyRawMarkdown = () => {
    const parsed = parseMarkdownToStocks(editableMd, stock.name);
    if (parsed.length === 0) return;
    const first = parsed[0];
    onUpdateStock({
      ...stock,
      name: first.name || stock.name,
      ticker: first.ticker || stock.ticker,
      market: first.market !== '미분류' ? first.market : stock.market,
      sector: first.sector || stock.sector,
      summaryNote: first.summaryNote,
      news: first.news,
      updatedAt: new Date().toISOString(),
    });
    setMdAppliedNotice(true);
    setTimeout(() => setMdAppliedNotice(false), 1800);
  };

  const timelineGroups = (() => {
    const groups: Array<{ label: string; items: NewsEntry[] }> = [];
    for (const item of filteredNews) {
      const label = item.date && /^\d{4}-\d{2}/.test(item.date)
        ? `${item.date.slice(0, 4)}.${item.date.slice(5, 7)}`
        : '날짜 미상';
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    }
    return groups;
  })();

  return (
    <div className="flex flex-1 flex-col min-w-0 bg-slate-950">
      {/* Stock Editorial Header */}
      <section className="border-b border-slate-800 bg-slate-900 bg-[radial-gradient(ellipse_at_top_left,_rgba(56,189,248,0.08),_transparent_55%)] px-6 py-5">
        {!isEditingHeader ? (
          <div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-50">
                    {stock.name}
                  </h1>
                  {stock.ticker && (
                    <span className="font-mono text-sm font-medium tabular-nums text-sky-400/90">
                      {stock.ticker}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>{stock.market}</span>
                  {stock.sector && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{stock.sector}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-300">
                    누적 뉴스 {stock.news.length.toLocaleString()}건
                  </span>
                  {stock.aliases.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>자동매칭 키워드: {stock.aliases.join(', ')}</span>
                    </>
                  )}
                </div>
                {stock.summaryNote && (
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-300 max-w-3xl">
                    {stock.summaryNote}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!isUnclassified && (
                  <button
                    type="button"
                    onClick={() => {
                      if (newsSearchRequest) {
                        onCloseNewsSearch();
                      } else {
                        onSearchStockNews(stock.name, stock.id);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      newsSearchRequest
                        ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                        : 'border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                    }`}
                  >
                    <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>최신 뉴스 검색</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingHeader(true)}
                  className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  종목 정보 / 메모 수정
                </button>
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      <span>복사됨</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Markdown 복사</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCopyTelegram}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  {copiedTelegram ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      <span>텔레그램 복사됨</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>텔레그램 복사</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadMd}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>.md 저장</span>
                </button>
              </div>
            </div>

            {stock.news.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-800/80 pt-3.5 md:grid-cols-3 md:gap-0 md:divide-x md:divide-slate-800/80">
                <div className="md:pr-5">
                  <div className="text-[11px] font-medium text-slate-500">기록 기간</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 font-mono text-xs tabular-nums text-slate-200">
                    <span>
                      {stockStats.earliest
                        ? stockStats.earliest === stockStats.latest
                          ? stockStats.earliest
                          : `${stockStats.earliest} ~ ${stockStats.latest}`
                        : '날짜 정보 없음'}
                    </span>
                    {stockStats.undatedCount > 0 && (
                      <span className="text-[11px] text-slate-500">
                        (미상 {stockStats.undatedCount}건)
                      </span>
                    )}
                  </div>
                </div>

                <div className="md:px-5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-slate-500">분류 비율 (클릭해 필터)</span>
                    {categoryFilter !== '전체' && (
                      <button
                        type="button"
                        onClick={() => setCategoryFilter('전체')}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        전체 보기
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    {stockStats.categoryCounts.map((item) => (
                      <button
                        key={item.category}
                        type="button"
                        onClick={() =>
                          setCategoryFilter((prev) =>
                            prev === item.category ? '전체' : item.category,
                          )
                        }
                        style={{ width: `${item.pct}%` }}
                        title={`${item.category} ${item.count}건`}
                        className={`h-full transition-opacity ${CATEGORY_BAR_COLORS[item.category]} ${
                          categoryFilter !== '전체' && categoryFilter !== item.category
                            ? 'opacity-30'
                            : 'opacity-90 hover:opacity-100'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                    {stockStats.categoryCounts.map((item) => (
                      <button
                        key={item.category}
                        type="button"
                        onClick={() =>
                          setCategoryFilter((prev) =>
                            prev === item.category ? '전체' : item.category,
                          )
                        }
                        className={`inline-flex items-center gap-1 font-mono tabular-nums transition-opacity ${
                          CATEGORY_TEXT_COLORS[item.category]
                        } ${
                          categoryFilter === item.category
                            ? 'underline underline-offset-4 font-semibold'
                            : 'opacity-85 hover:opacity-100'
                        }`}
                      >
                        <span>{item.category}</span>
                        <span>{item.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:pl-5">
                  <div className="text-[11px] font-medium text-slate-500">주요 출처</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-300">
                    {stockStats.topSources.length === 0 ? (
                      <span className="text-slate-500">-</span>
                    ) : (
                      stockStats.topSources.map((src, idx) => (
                        <span key={src.source} className="inline-flex items-center gap-1">
                          {idx > 0 && (
                            <span className="text-slate-600 mr-1" aria-hidden="true">
                              ·
                            </span>
                          )}
                          <span>{src.source}</span>
                          <span className="font-mono text-[11px] tabular-nums text-slate-500">
                            {src.count}
                          </span>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSaveHeader} className="space-y-3 max-w-3xl">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="종목명"
                required
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-semibold text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <input
                type="text"
                value={editTicker}
                onChange={(e) => setEditTicker(e.target.value)}
                placeholder="종목코드 (예: 005930)"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <select
                value={editMarket}
                onChange={(e) => setEditMarket(e.target.value as MarketType)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value="KOSPI">KOSPI</option>
                <option value="KOSDAQ">KOSDAQ</option>
                <option value="해외">해외</option>
                <option value="미분류">미분류</option>
              </select>
              <input
                type="text"
                value={editSector}
                onChange={(e) => setEditSector(e.target.value)}
                placeholder="섹터 (예: 반도체)"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <input
              type="text"
              value={editAliases}
              onChange={(e) => setEditAliases(e.target.value)}
              placeholder="자동 매칭 별칭 (쉼표 구분, 예: 삼전, Samsung)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <textarea
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              rows={2}
              placeholder="핵심 투자 포인트 및 트래킹 메모"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => setIsEditingHeader(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
              >
                취소
              </button>
            </div>
          </form>
        )}
      </section>

      <LatestNewsPanel
        isOpen={Boolean(newsSearchRequest)}
        stock={
          newsSearchRequest?.targetStockId
            ? allStocks.find((s) => s.id === newsSearchRequest.targetStockId) ?? stock
            : newsSearchRequest && !newsSearchRequest.targetStockId
              ? undefined
              : stock
        }
        initialQuery={newsSearchRequest?.query ?? stock.name}
        requestId={newsSearchRequest?.id ?? 0}
        onClose={onCloseNewsSearch}
        onAddNewsItems={onAddNewsItems}
      />

      {/* Quick Inline News Add Bar */}
      {quickAddSection}

      {/* Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/40 px-6 py-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800">
          {(
            [
              { id: 'timeline', label: '타임라인' },
              { id: 'markdown', label: 'Markdown 원문' },
              { id: 'split', label: '분할 보기' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setViewMode(mode.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                viewMode === mode.id
                  ? 'bg-slate-800 text-slate-100 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="기사 제목·메모 검색"
              className="w-44 rounded-lg border border-slate-700/80 bg-slate-900 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as '전체' | NewsCategory)}
            className="rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="전체">전체 분류</option>
            {NEWS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={isSyncingDates || stock.news.length === 0}
            onClick={() => void handleSyncStockDates()}
            title="링크에서 기사 제목과 날짜를 다시 확인해 빠른순으로 정리합니다"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isSyncingDates ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>제목·날짜 확인 중...</span>
              </>
            ) : (
              <>
                <CalendarClock className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                <span>{dateSyncNotice || '제목·날짜 자동 정리'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsClassifyMode((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              classifyActive
                ? 'border-amber-700/70 bg-amber-950/50 text-amber-200'
                : 'border-slate-700/80 bg-slate-900 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{classifyActive ? '종목 구분 중' : '종목 구분/이동'}</span>
          </button>

          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            className="rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {sortOrder === 'asc' ? '날짜 빠른순 (과거→최신)' : '최신순 (최신→과거)'}
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div
        className={`flex-1 overflow-y-auto p-6 ${
          viewMode === 'split' ? 'grid grid-cols-1 gap-6 xl:grid-cols-2' : ''
        }`}
      >
        {(viewMode === 'timeline' || viewMode === 'split') && (
          <div className="space-y-4">
            {classifyActive && stock.news.length > 0 && (
              <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-amber-200">
                      {isUnclassified
                        ? `구분되지 않은 뉴스 ${stock.news.length}건 모음`
                        : '선택 항목을 다른 종목으로 이동'}
                    </div>
                    <p className="mt-0.5 text-[11px] text-amber-300/80">
                      상단 검색창에 종목명이나 키워드를 쳐서 걸러낸 뒤 &lsquo;현재 목록 전체 선택&rsquo;으로 한 번에 원하는 종목으로 옮길 수 있습니다.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {autoMatchMoves.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onMoveNewsMap(autoMatchMoves, stock.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>기존 종목 일치 {autoMatchMoves.length}건 자동 이동</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      className="rounded-lg border border-amber-700/70 bg-slate-900 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-950/60 whitespace-nowrap"
                    >
                      {allFilteredSelected
                        ? '현재 목록 선택 해제'
                        : `현재 목록 전체 선택 (${filteredNews.length}건)`}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-amber-800/50 pt-3">
                  <span className="font-mono text-xs font-semibold text-amber-200 tabular-nums">
                    선택 {selectedNewsIds.length}건
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  <SearchableStockPicker
                    stocks={regularTargetStocks}
                    selectedStockId={bulkTargetStockId}
                    selectedNewStockName={bulkNewStockName}
                    showSelectedLabel={true}
                    placeholder="이동할 종목 검색·선택..."
                    buttonClassName="min-w-[200px] border-amber-700/70 text-slate-100"
                    onSelectStock={(stockId) => {
                      setBulkTargetStockId(stockId);
                      setBulkNewStockName('');
                    }}
                    onSelectNewStock={(stockName) => {
                      setBulkTargetStockId('');
                      setBulkNewStockName(stockName);
                    }}
                    onClear={() => {
                      setBulkTargetStockId('');
                      setBulkNewStockName('');
                    }}
                  />

                  <button
                    type="button"
                    disabled={
                      selectedNewsIds.length === 0 ||
                      (!bulkTargetStockId && !bulkNewStockName.trim())
                    }
                    onClick={handleApplyBulkMove}
                    className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                  >
                    선택 항목 이동
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
              {filteredNews.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium text-slate-300">표시할 뉴스가 없습니다</p>
                  <p className="mt-1 text-xs text-slate-500">
                    상단 입력창에 뉴스 링크를 추가하거나 &lsquo;뉴스 일괄 병합&rsquo; 탭에서 여러 기사를 한꺼번에 합쳐보세요.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {timelineGroups.map((group) => (
                    <div key={group.label}>
                      <div className="flex items-center justify-between border-b border-slate-800/70 bg-slate-950/60 px-5 py-2">
                        <span className="font-mono text-xs font-semibold tabular-nums text-slate-300">
                          {group.label}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-500">
                          {group.items.length}건
                        </span>
                      </div>

                      <div className="divide-y divide-slate-800/50">
                        {group.items.map((item) => {
                          const isSelected = visibleSelectedSet.has(item.id);
                          const suggestedTarget = classifyActive
                            ? matchStockInText(`${item.title} ${item.memo}`, regularTargetStocks)
                            : undefined;

                          return (
                            <div
                              key={item.id}
                              className={`group flex flex-col gap-2 px-5 py-3.5 transition-colors ${
                                isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/45'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                  {classifyActive ? (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleSelectNews(item.id)}
                                      aria-label={`${item.title} 선택`}
                                      className="mt-1 h-4 w-4 accent-sky-400 shrink-0 cursor-pointer"
                                    />
                                  ) : (
                                    <div
                                      className="mt-2 flex items-center shrink-0"
                                      aria-hidden="true"
                                    >
                                      <span className="h-px w-2.5 bg-slate-700 group-hover:bg-sky-400/70 transition-colors" />
                                    </div>
                                  )}

                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                      <input
                                        type="date"
                                        value={item.date}
                                        onChange={(e) =>
                                          handleUpdateNewsDate(item.id, e.target.value)
                                        }
                                        aria-label="기사 날짜"
                                        title="날짜 클릭해 수정"
                                        className={`bg-transparent font-mono tabular-nums text-xs font-medium focus:bg-slate-950 focus:px-1.5 focus:rounded focus:outline-none cursor-pointer ${
                                          item.date ? 'text-slate-300' : 'text-slate-500'
                                        }`}
                                      />
                                      <span aria-hidden="true">·</span>
                                      <select
                                        value={item.category}
                                        onChange={(e) =>
                                          handleUpdateNewsCategory(
                                            item.id,
                                            e.target.value as NewsCategory,
                                          )
                                        }
                                        aria-label="뉴스 분류"
                                        className={`bg-transparent text-xs font-semibold hover:underline focus:outline-none cursor-pointer ${
                                          CATEGORY_TEXT_COLORS[item.category]
                                        }`}
                                      >
                                        {NEWS_CATEGORIES.map((c) => (
                                          <option key={c} value={c}>
                                            {c}
                                          </option>
                                        ))}
                                      </select>
                                      <span aria-hidden="true">·</span>
                                      <span>{item.source}</span>
                                      {suggestedTarget && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onMoveNews(item.id, stock.id, suggestedTarget.id)
                                          }
                                          className="inline-flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-700/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/60"
                                        >
                                          <span>추천: {suggestedTarget.name}</span>
                                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                          <span>이동</span>
                                        </button>
                                      )}
                                    </div>

                                    {editingNewsId === item.id ? (
                                      <form
                                        onSubmit={(e) => {
                                          e.preventDefault();
                                          handleSaveEditedNews(item.id);
                                        }}
                                        className="mt-2 space-y-2 rounded-lg border border-slate-700/80 bg-slate-950/70 p-2.5"
                                      >
                                        <input
                                          type="text"
                                          value={editNewsTitle}
                                          onChange={(e) => setEditNewsTitle(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Escape') cancelEditingNews();
                                          }}
                                          placeholder="기사 제목"
                                          aria-label="기사 제목 수정"
                                          className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-100 focus:border-sky-500 focus:outline-none"
                                        />
                                        <input
                                          type="text"
                                          value={editNewsUrl}
                                          onChange={(e) => setEditNewsUrl(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Escape') cancelEditingNews();
                                          }}
                                          placeholder="https://..."
                                          aria-label="하이퍼링크 URL 수정"
                                          className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                                        />
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          {editNewsError ? (
                                            <span className="text-[11px] text-rose-400">
                                              {editNewsError}
                                            </span>
                                          ) : (
                                            <span />
                                          )}
                                          <div className="flex items-center gap-1.5">
                                            <button
                                              type="button"
                                              onClick={cancelEditingNews}
                                              className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                                            >
                                              취소
                                            </button>
                                            <button
                                              type="submit"
                                              className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-sky-400"
                                            >
                                              저장
                                            </button>
                                          </div>
                                        </div>
                                      </form>
                                    ) : (
                                      <a
                                        href={isSafeHttpUrl(item.url) ? item.url : '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-1 inline-flex items-baseline gap-1.5 text-sm font-semibold text-slate-100 hover:text-sky-300 hover:underline break-words"
                                      >
                                        <span>{item.title}</span>
                                        <ExternalLink
                                          className="h-3 w-3 shrink-0 text-slate-500"
                                          aria-hidden="true"
                                        />
                                      </a>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <SearchableStockPicker
                                    stocks={regularTargetStocks}
                                    align="right"
                                    showSelectedLabel={false}
                                    placeholder="종목 검색·이동"
                                    buttonClassName={`text-[11px] py-1 px-2 transition-opacity ${
                                      classifyActive
                                        ? 'opacity-100 border-slate-600'
                                        : 'opacity-0 group-hover:opacity-100 focus:opacity-100 border-slate-700'
                                    }`}
                                    onSelectStock={(targetId) =>
                                      onMoveNews(item.id, stock.id, targetId)
                                    }
                                    onSelectNewStock={(newName) =>
                                      onMoveNewsBulk([item.id], stock.id, '', newName)
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      editingNewsId === item.id
                                        ? cancelEditingNews()
                                        : startEditingNews(item)
                                    }
                                    title="제목·하이퍼링크 수정"
                                    aria-label="제목과 하이퍼링크 수정"
                                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-sky-300 transition-opacity"
                                  >
                                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteNews(item.id)}
                                    aria-label="뉴스 삭제"
                                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1.5 text-slate-500 hover:bg-rose-950/70 hover:text-rose-400 transition-opacity"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>

                              <input
                                type="text"
                                value={item.memo}
                                onChange={(e) => handleUpdateNewsMemo(item.id, e.target.value)}
                                placeholder="메모 추가..."
                                className={`w-full rounded bg-transparent py-0.5 text-xs text-slate-300 placeholder:text-slate-600 focus:bg-slate-950 focus:px-2 focus:ring-1 focus:ring-slate-700 focus:outline-none ${
                                  classifyActive ? 'pl-7' : 'pl-5'
                                }`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {(viewMode === 'markdown' || viewMode === 'split') && (
          <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-200">
                Markdown 원문 편집기
              </span>
              <div className="flex items-center gap-2">
                {mdAppliedNotice && (
                  <span className="text-xs font-medium text-emerald-400">적용 완료</span>
                )}
                <button
                  type="button"
                  onClick={handleApplyRawMarkdown}
                  className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                >
                  수정한 내용 반영하기
                </button>
              </div>
            </div>
            <textarea
              value={editableMd}
              onChange={(e) => setEditableMd(e.target.value)}
              rows={20}
              spellCheck={false}
              className="flex-1 w-full resize-y bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
