import { Inbox, Newspaper, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarketType, StockItem } from '../types/stock';
import { isUnclassifiedStock } from '../utils/markdownEngine';

interface StockSidebarProps {
  stocks: StockItem[];
  selectedStockId: string;
  onSelectStock: (id: string) => void;
  onOpenQuickJump: () => void;
  onSearchStockNews: (query: string, stockId?: string) => void;
  onAddStock: (name: string, ticker: string, market: MarketType, sector: string) => void;
  onDeleteStock: (id: string) => void;
  onDeleteEmptyStocks: () => void;
  onClearAllStocks: () => void;
}

type SidebarSortMode = 'default' | 'news-desc' | 'name-asc' | 'recent';

const MARKET_FILTERS: Array<'전체' | MarketType> = ['전체', 'KOSPI', 'KOSDAQ', '해외'];

export function StockSidebar({
  stocks,
  selectedStockId,
  onSelectStock,
  onOpenQuickJump,
  onSearchStockNews,
  onAddStock,
  onDeleteStock,
  onDeleteEmptyStocks,
  onClearAllStocks,
}: StockSidebarProps) {
  const unclassifiedStock = stocks.find((s) => isUnclassifiedStock(s));
  const regularStocks = useMemo(() => stocks.filter((s) => !isUnclassifiedStock(s)), [stocks]);
  const emptyCount = regularStocks.filter((s) => s.news.length === 0).length;
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<'전체' | MarketType>('전체');
  const [sortMode, setSortMode] = useState<SidebarSortMode>('default');
  const [isAdding, setIsAdding] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTicker, setNewTicker] = useState('');
  const [newMarket, setNewMarket] = useState<MarketType>('KOSPI');
  const [newSector, setNewSector] = useState('');
  const listContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedStockId || !listContainerRef.current) return;
    const target = listContainerRef.current.querySelector<HTMLElement>(
      `[data-stock-id="${CSS.escape(selectedStockId)}"]`,
    );
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedStockId]);

  const filteredStocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = regularStocks.filter((s) => {
      const matchesMarket = marketFilter === '전체' || s.market === marketFilter;
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.ticker.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q) ||
        s.aliases.some((a) => a.toLowerCase().includes(q));
      return matchesMarket && matchesSearch;
    });
    if (sortMode === 'news-desc') {
      return [...list].sort((a, b) => b.news.length - a.news.length);
    }
    if (sortMode === 'name-asc') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }
    if (sortMode === 'recent') {
      return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return list;
  }, [regularStocks, marketFilter, searchQuery, sortMode]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAddStock(newName.trim(), newTicker.trim().toUpperCase(), newMarket, newSector.trim());
    setNewName('');
    setNewTicker('');
    setNewSector('');
    setIsAdding(false);
  };

  return (
    <aside className="flex w-full flex-col border-b border-slate-800 bg-slate-900 max-h-[420px] lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:max-h-[calc(100vh-3.5rem)] lg:w-[280px] lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="shrink-0 border-b border-slate-800 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-xs font-semibold text-slate-400 whitespace-nowrap">
            등록 상장사 <span className="font-mono tabular-nums text-slate-100">{regularStocks.length.toLocaleString()}</span>
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {emptyCount > 0 && (
              <button
                type="button"
                onClick={onDeleteEmptyStocks}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-400 hover:bg-rose-950/60 transition-colors whitespace-nowrap shrink-0"
                title="뉴스가 0건인 종목 일괄 삭제"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span>0건 삭제 ({emptyCount})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsAdding((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-400 hover:bg-sky-950/60 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>종목 추가</span>
            </button>
          </div>
        </div>

        <div className="relative mb-2.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && searchQuery.trim()) {
                e.preventDefault();
                const q = searchQuery.trim();
                const exact = filteredStocks.find(
                  (s) =>
                    s.name.toLowerCase() === q.toLowerCase() ||
                    s.ticker.toLowerCase() === q.toLowerCase(),
                );
                const single = filteredStocks.length === 1 ? filteredStocks[0] : exact;
                if (single) {
                  onSelectStock(single.id);
                  onSearchStockNews(single.name, single.id);
                } else {
                  onSearchStockNews(q);
                }
              }
            }}
            placeholder="종목명, 코드, 섹터 검색 (Enter: 최신뉴스)"
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950/70 py-1.5 pl-8 pr-14 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
          />
          <button
            type="button"
            onClick={onOpenQuickJump}
            title="빠른 종목 검색·이동 (Ctrl+K)"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-slate-700/90 bg-slate-800/90 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-300 hover:border-sky-500/60 hover:text-sky-300 transition-colors"
          >
            Ctrl+K
          </button>
        </div>

        {searchQuery.trim() && (
          <button
            type="button"
            onClick={() => {
              const q = searchQuery.trim();
              const exact = filteredStocks.find(
                (s) =>
                  s.name.toLowerCase() === q.toLowerCase() ||
                  s.ticker.toLowerCase() === q.toLowerCase(),
              );
              const target = filteredStocks.length === 1 ? filteredStocks[0] : exact;
              if (target) {
                onSelectStock(target.id);
                onSearchStockNews(target.name, target.id);
              } else {
                onSearchStockNews(q);
              }
            }}
            className="mb-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2.5 py-1.5 text-left text-[11px] font-medium text-sky-300 hover:bg-sky-500/20 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <Newspaper className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">&lsquo;{searchQuery.trim()}&rsquo; 최신 뉴스 검색</span>
            </span>
            <span className="font-mono text-[10px] text-sky-400/90 shrink-0">Enter</span>
          </button>
        )}

        <div className="flex items-center gap-1 rounded-lg bg-slate-950/80 p-1 border border-slate-800/80">
          {MARKET_FILTERS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarketFilter(m)}
              className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                marketFilter === m
                  ? 'bg-slate-800 text-slate-50 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">
            표시 {filteredStocks.length.toLocaleString()}개
          </span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'default', label: '기본' },
                { id: 'news-desc', label: '뉴스순' },
                { id: 'name-asc', label: '가나다' },
                { id: 'recent', label: '최근순' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortMode(opt.id)}
                className={`rounded px-1.5 py-0.5 transition-colors whitespace-nowrap ${
                  sortMode === opt.id
                    ? 'bg-slate-800 text-sky-300 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleCreate} className="shrink-0 border-b border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
          <div className="text-xs font-semibold text-slate-200">새 상장사 등록</div>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="종목명 (예: 알테오젠)"
            required
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value)}
              placeholder="코드 (예: 196170)"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
            <select
              value={newMarket}
              onChange={(e) => setNewMarket(e.target.value as MarketType)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="KOSPI">KOSPI</option>
              <option value="KOSDAQ">KOSDAQ</option>
              <option value="해외">해외</option>
              <option value="미분류">미분류</option>
            </select>
          </div>
          <input
            type="text"
            value={newSector}
            onChange={(e) => setNewSector(e.target.value)}
            placeholder="섹터 (예: 바이오)"
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              등록
            </button>
          </div>
        </form>
      )}

      {unclassifiedStock && unclassifiedStock.news.length > 0 && (
        <div className="shrink-0 border-b border-amber-900/60 bg-amber-950/30 p-2.5">
          <button
            type="button"
            onClick={() => onSelectStock(unclassifiedStock.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
              unclassifiedStock.id === selectedStockId
                ? 'border-amber-500/70 bg-amber-950/70 text-amber-100'
                : 'border-amber-800/60 bg-slate-900/90 text-slate-100 hover:border-amber-600/70 hover:bg-amber-950/40'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Inbox className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-amber-200">
                  미분류 뉴스 (구분 필요)
                </div>
                <div className="truncate text-[10px] text-amber-300/80">
                  클릭해서 종목별로 분류하기
                </div>
              </div>
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-amber-300 shrink-0">
              {unclassifiedStock.news.length}건
            </span>
          </button>
        </div>
      )}

      <div
        ref={listContainerRef}
        className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/60 sidebar-scrollbar"
      >
        {filteredStocks.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 space-y-3">
            <div>
              {regularStocks.length === 0
                ? unclassifiedStock && unclassifiedStock.news.length > 0
                  ? '아직 분류된 상장사가 없습니다. 위 미분류 뉴스에서 종목으로 이동해보세요.'
                  : '저장된 종목이 없습니다. 파일을 불러오거나 새 종목을 추가하세요.'
                : '일치하는 종목이 없습니다.'}
            </div>
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => onSearchStockNews(searchQuery.trim())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
                <span>&lsquo;{searchQuery.trim()}&rsquo; 최신 뉴스 검색</span>
              </button>
            )}
          </div>
        ) : (
          filteredStocks.map((stock) => {
            const isSelected = stock.id === selectedStockId;
            return (
              <div
                key={stock.id}
                data-stock-id={stock.id}
                className={`group flex items-center justify-between gap-2 px-4 py-3 transition-colors ${
                  isSelected
                    ? 'bg-sky-500/15 ring-1 ring-inset ring-sky-400/25'
                    : 'hover:bg-slate-800/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectStock(stock.id);
                    if (searchQuery.trim()) {
                      onSearchStockNews(stock.name, stock.id);
                    }
                  }}
                  className="flex min-w-0 flex-1 flex-col text-left focus:outline-none"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate text-sm font-semibold ${
                        isSelected ? 'text-sky-300' : 'text-slate-100'
                      }`}
                    >
                      {stock.name}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-slate-400 shrink-0">
                      {stock.news.length}건
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                    {stock.ticker && (
                      <span className="font-mono tabular-nums">{stock.ticker}</span>
                    )}
                    {stock.ticker && (stock.market !== '미분류' || stock.sector) && (
                      <span aria-hidden="true">·</span>
                    )}
                    {stock.market !== '미분류' && <span>{stock.market}</span>}
                    {stock.market !== '미분류' && stock.sector && (
                      <span aria-hidden="true">·</span>
                    )}
                    {stock.sector && <span className="truncate">{stock.sector}</span>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteStock(stock.id)}
                  title="종목 삭제"
                  aria-label={`${stock.name} 삭제`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1 text-slate-500 hover:bg-rose-950/70 hover:text-rose-400 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {stocks.length > 0 && (
        <div className="shrink-0 border-t border-slate-800 bg-slate-950/60 px-4 py-2.5">
          {!confirmClearAll ? (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-rose-400 hover:border-rose-800/70 hover:bg-rose-950/50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>저장된 종목 전체 삭제 ({stocks.length})</span>
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-rose-300">전체 삭제할까요?</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearAllStocks();
                    setConfirmClearAll(false);
                  }}
                  className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                >
                  삭제
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
