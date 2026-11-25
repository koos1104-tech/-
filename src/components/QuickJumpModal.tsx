import { ArrowRight, Newspaper, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StockItem } from '../types/stock';
import { isUnclassifiedStock } from '../utils/markdownEngine';

interface QuickJumpModalProps {
  isOpen: boolean;
  stocks: StockItem[];
  selectedStockId: string;
  onClose: () => void;
  onSelectStock: (stockId: string) => void;
  onSearchStockNews?: (query: string, stockId?: string) => void;
}

const MAX_RESULTS = 60;

export function QuickJumpModal({
  isOpen,
  stocks,
  selectedStockId,
  onClose,
  onSelectStock,
  onSearchStockNews,
}: QuickJumpModalProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const orderedStocks = useMemo(() => {
    const unclassified = stocks.filter((s) => isUnclassifiedStock(s) && s.news.length > 0);
    const regular = stocks.filter((s) => !isUnclassifiedStock(s));
    return [...unclassified, ...regular];
  }, [stocks]);

  const matchedStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...orderedStocks]
        .sort((a, b) => b.news.length - a.news.length)
        .slice(0, MAX_RESULTS);
    }

    const exactStarts: StockItem[] = [];
    const contains: StockItem[] = [];
    for (const s of orderedStocks) {
      const nameLower = s.name.toLowerCase();
      const tickerLower = s.ticker.toLowerCase();
      const sectorLower = s.sector.toLowerCase();
      const aliasMatch = s.aliases.some((a) => a.toLowerCase().includes(q));
      if (nameLower.startsWith(q) || tickerLower.startsWith(q)) {
        exactStarts.push(s);
      } else if (
        nameLower.includes(q) ||
        tickerLower.includes(q) ||
        sectorLower.includes(q) ||
        aliasMatch
      ) {
        contains.push(s);
      }
      if (exactStarts.length + contains.length >= MAX_RESULTS) break;
    }
    return [...exactStarts, ...contains].slice(0, MAX_RESULTS);
  }, [orderedStocks, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const handleSelect = (stockId: string) => {
    onSelectStock(stockId);
    onClose();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (matchedStocks.length > 0) {
        setActiveIndex((prev) => (prev + 1) % matchedStocks.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (matchedStocks.length > 0) {
        setActiveIndex((prev) => (prev - 1 + matchedStocks.length) % matchedStocks.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = matchedStocks[activeIndex];
      if (target) {
        handleSelect(target.id);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/75 px-4 pt-[12vh] backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-950/70 px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="종목명, 종목코드(6자리/티커), 섹터로 빠른 이동..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="검색어 지우기"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
          >
            ESC
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto divide-y divide-slate-800/70 sidebar-scrollbar">
          {matchedStocks.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-slate-400 space-y-3">
              <div>일치하는 종목이 없습니다.</div>
              {query.trim() && onSearchStockNews && (
                <button
                  type="button"
                  onClick={() => {
                    onSearchStockNews(query.trim());
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                >
                  <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>&lsquo;{query.trim()}&rsquo; 최신 뉴스 검색하기</span>
                </button>
              )}
            </div>
          ) : (
            matchedStocks.map((stock, idx) => {
              const isHighlighted = idx === activeIndex;
              const isCurrent = stock.id === selectedStockId;
              const latestDated = stock.news.reduce<string>((latest, item) => {
                if (!item.date) return latest;
                return item.date > latest ? item.date : latest;
              }, '');

              return (
                <div
                  key={stock.id}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 transition-colors ${
                    isHighlighted
                      ? 'bg-sky-500/15 text-slate-50'
                      : isCurrent
                        ? 'bg-slate-800/60 text-slate-100'
                        : 'text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelect(stock.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left focus:outline-none"
                  >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`truncate text-sm font-semibold ${
                          isHighlighted ? 'text-sky-300' : 'text-slate-100'
                        }`}
                      >
                        {stock.name}
                      </span>
                      {stock.ticker && (
                        <span className="font-mono text-xs tabular-nums text-slate-400">
                          {stock.ticker}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      <span>{stock.market}</span>
                      {stock.sector && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{stock.sector}</span>
                        </>
                      )}
                      {latestDated && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">최근 {latestDated}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-xs tabular-nums text-slate-400">
                      {stock.news.length}건
                    </span>
                    {isHighlighted && (
                      <ArrowRight className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                    )}
                  </div>
                  </button>
                  {onSearchStockNews && !isUnclassifiedStock(stock) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSearchStockNews(stock.name, stock.id);
                        onClose();
                      }}
                      title={`${stock.name} 최신 뉴스 검색`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900/90 px-2 py-1 text-[11px] font-medium text-sky-300 hover:border-sky-500/60 hover:bg-sky-950/60 whitespace-nowrap shrink-0"
                    >
                      <Newspaper className="h-3 w-3" aria-hidden="true" />
                      <span>최신뉴스</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/70 px-4 py-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              전체 <span className="font-mono tabular-nums text-slate-300">{stocks.length.toLocaleString()}</span>개 중{' '}
              {query.trim() ? '검색 상위' : '뉴스 많은 순'} 표시
            </span>
            {query.trim() && onSearchStockNews && matchedStocks.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onSearchStockNews(query.trim());
                  onClose();
                }}
                className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-medium"
              >
                <Newspaper className="h-3 w-3" aria-hidden="true" />
                <span>&lsquo;{query.trim()}&rsquo; 최신 뉴스 검색</span>
              </button>
            )}
          </div>
          <span className="font-mono">↑↓ 이동 · Enter 선택</span>
        </div>
      </div>
    </div>
  );
}
