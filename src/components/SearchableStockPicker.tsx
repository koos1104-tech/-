import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StockItem } from '../types/stock';
import { isInvalidStockHeading } from '../utils/markdownEngine';

interface SearchableStockPickerProps {
  stocks: StockItem[];
  selectedStockId?: string;
  selectedNewStockName?: string;
  placeholder?: string;
  buttonClassName?: string;
  align?: 'left' | 'right';
  showSelectedLabel?: boolean;
  onSelectStock: (stockId: string) => void;
  onSelectNewStock: (stockName: string) => void;
  onClear?: () => void;
  clearLabel?: string;
}

export function SearchableStockPicker({
  stocks,
  selectedStockId = '',
  selectedNewStockName = '',
  placeholder = '종목 검색·이동...',
  buttonClassName = '',
  align = 'left',
  showSelectedLabel = false,
  onSelectStock,
  onSelectNewStock,
  onClear,
  clearLabel = '선택 해제',
}: SearchableStockPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [coords, setCoords] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  }>({ left: 0, top: 0, width: 272 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popoverWidth = Math.max(272, Math.min(320, rect.width + 80));
    const openUpward =
      window.innerHeight - rect.bottom < 290 && rect.top > 290;
    const rawLeft = align === 'right' ? rect.right - popoverWidth : rect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - popoverWidth - 8));

    if (openUpward) {
      setCoords({
        left,
        bottom: window.innerHeight - rect.top + 4,
        width: popoverWidth,
      });
    } else {
      setCoords({
        left,
        top: rect.bottom + 4,
        width: popoverWidth,
      });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    setActiveIndex(0);
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleScrollOrResize = () => updatePosition();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    document.addEventListener('keydown', handleKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, align]);

  const trimmedQuery = query.trim();
  const filteredStocks = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    if (!q) return stocks;
    return stocks.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.ticker && s.ticker.toLowerCase().includes(q)) ||
        (s.sector && s.sector.toLowerCase().includes(q)) ||
        s.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [stocks, trimmedQuery]);

  const hasExactExisting = useMemo(() => {
    if (!trimmedQuery) return false;
    const q = trimmedQuery.toLowerCase();
    return stocks.some(
      (s) =>
        s.name.toLowerCase() === q ||
        (s.ticker && s.ticker.toLowerCase() === q) ||
        s.aliases.some((a) => a.trim().toLowerCase() === q),
    );
  }, [stocks, trimmedQuery]);

  const canCreateNew = Boolean(
    trimmedQuery && !hasExactExisting && !isInvalidStockHeading(trimmedQuery),
  );

  const renderedStocks = filteredStocks.slice(0, 80);
  const totalOptions = renderedStocks.length + (canCreateNew ? 1 : 0);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery]);

  const selectedStock = selectedStockId
    ? stocks.find((s) => s.id === selectedStockId)
    : undefined;

  let triggerLabel = placeholder;
  if (showSelectedLabel) {
    if (selectedStock) {
      triggerLabel = selectedStock.ticker
        ? `${selectedStock.name} (${selectedStock.ticker})`
        : selectedStock.name;
    } else if (selectedNewStockName) {
      triggerLabel = `+ 새 종목: ${selectedNewStockName}`;
    }
  }

  const handlePickExisting = (stockId: string) => {
    onSelectStock(stockId);
    setIsOpen(false);
    setQuery('');
  };

  const handlePickNew = () => {
    if (!canCreateNew) return;
    onSelectNewStock(trimmedQuery);
    setIsOpen(false);
    setQuery('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalOptions > 0) {
        setActiveIndex((prev) => (prev + 1) % totalOptions);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalOptions > 0) {
        setActiveIndex((prev) => (prev - 1 + totalOptions) % totalOptions);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (renderedStocks[activeIndex]) {
        handlePickExisting(renderedStocks[activeIndex].id);
      } else if (canCreateNew) {
        handlePickNew();
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center justify-between gap-1.5 rounded border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700/80 focus:border-sky-500 focus:outline-none ${buttonClassName}`}
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <Search className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              left: `${coords.left}px`,
              top: coords.top !== undefined ? `${coords.top}px` : undefined,
              bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
              width: `${coords.width}px`,
              zIndex: 9999,
            }}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center gap-1.5 border-b border-slate-800 bg-slate-950/70 px-2.5 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="종목명·코드 검색 또는 새 종목 입력"
                className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="검색어 지우기"
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/70">
              {showSelectedLabel && (selectedStockId || selectedNewStockName) && onClear && (
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setIsOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
                >
                  <span>{clearLabel}</span>
                </button>
              )}

              {filteredStocks.length === 0 && !canCreateNew ? (
                <div className="px-3 py-5 text-center text-xs text-slate-400">
                  {stocks.length === 0
                    ? '등록된 종목이 없습니다. 이동할 종목명을 입력하세요.'
                    : '일치하는 종목이 없습니다.'}
                </div>
              ) : (
                renderedStocks.map((s, idx) => {
                  const isHighlighted = idx === activeIndex;
                  const isCurrent = s.id === selectedStockId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handlePickExisting(s.id)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                        isHighlighted
                          ? 'bg-sky-500/20 text-sky-200'
                          : isCurrent
                            ? 'bg-slate-800 text-slate-100 font-semibold'
                            : 'text-slate-200 hover:bg-slate-800/70'
                      }`}
                    >
                      <span className="truncate font-medium">
                        {s.name}
                        {s.ticker && (
                          <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                            {s.ticker}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-400 shrink-0">
                        {s.news.length}건
                      </span>
                    </button>
                  );
                })
              )}

              {filteredStocks.length > renderedStocks.length && (
                <div className="px-3 py-2 text-center text-[11px] text-slate-500">
                  상위 {renderedStocks.length}개 표시 · 검색어를 입력해 {filteredStocks.length.toLocaleString()}개 중 찾기
                </div>
              )}

              {canCreateNew && (
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(renderedStocks.length)}
                  onClick={handlePickNew}
                  className={`flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold transition-colors ${
                    activeIndex === renderedStocks.length
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-sky-950/60 text-sky-300 hover:bg-sky-900/60'
                  }`}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">&lsquo;{trimmedQuery}&rsquo; 새 종목으로 이동</span>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
