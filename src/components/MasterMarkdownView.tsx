import { Check, Copy, Download, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  MarkdownExportPreset,
  MarkdownFormatConfig,
  MarkdownHeadingLevel,
  MarkdownLinkStyle,
  SortOrder,
  StockItem,
} from '../types/stock';
import {
  compileWorkspaceToMarkdown,
  compileWorkspaceToTelegramChunks,
  isUnclassifiedStock,
  parseMarkdownToStocks,
} from '../utils/markdownEngine';

interface MasterMarkdownViewProps {
  stocks: StockItem[];
  config: MarkdownFormatConfig;
  onChangeConfig: (next: MarkdownFormatConfig) => void;
  onReplaceAllStocks: (nextStocks: StockItem[]) => void;
}

type ExportTabMode = 'markdown' | 'telegram';

export function MasterMarkdownView({
  stocks,
  config,
  onChangeConfig,
  onReplaceAllStocks,
}: MasterMarkdownViewProps) {
  const [exportMode, setExportMode] = useState<ExportTabMode>('markdown');
  const compiled = compileWorkspaceToMarkdown(stocks, config);
  const telegramChunks = compileWorkspaceToTelegramChunks(stocks, config);

  const [editorText, setEditorText] = useState(compiled);
  const [copied, setCopied] = useState(false);
  const [copiedChunkIndex, setCopiedChunkIndex] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    setEditorText(compiled);
  }, [compiled]);

  const activePreset: MarkdownExportPreset = config.exportPreset ?? 'bot-archive';
  const unclassifiedNewsCount = stocks
    .filter((s) => isUnclassifiedStock(s))
    .reduce((sum, s) => sum + s.news.length, 0);
  const emptyRegularCount = stocks.filter(
    (s) => !isUnclassifiedStock(s) && s.news.length === 0,
  ).length;
  const regularActiveCount = stocks.filter(
    (s) => !isUnclassifiedStock(s) && s.news.length > 0,
  ).length;
  const activeStocksCount =
    activePreset === 'bot-archive'
      ? regularActiveCount
      : stocks.filter((s) => s.news.length > 0).length;
  const totalNews =
    activePreset === 'bot-archive'
      ? stocks
          .filter((s) => !isUnclassifiedStock(s))
          .reduce((sum, s) => sum + s.news.length, 0)
      : stocks.reduce((sum, s) => sum + s.news.length, 0);
  const fileSizeMb = (new Blob([editorText]).size / (1024 * 1024)).toFixed(2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editorText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleCopyChunk = async (index: number, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedChunkIndex(index);
    setTimeout(() => setCopiedChunkIndex(null), 1800);
  };

  const handleDownload = () => {
    const blob = new Blob([editorText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '종목뉴스_전체.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyEditedMarkdown = () => {
    const parsed = parseMarkdownToStocks(editorText).filter((s) => s.news.length > 0);
    if (parsed.length > 0) {
      onReplaceAllStocks(parsed);
      setApplied(true);
      setTimeout(() => setApplied(false), 1800);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            전체 상장사 통합 Markdown &amp; 텔레그램 내보내기
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            내보내기 기준 <span className="font-mono tabular-nums font-medium text-slate-100">{activeStocksCount.toLocaleString()}</span>개 종목 ·{' '}
            <span className="font-mono tabular-nums font-medium text-slate-100">{totalNews.toLocaleString()}</span>건의 뉴스 ·{' '}
            <span className="font-mono tabular-nums font-medium text-slate-100">{fileSizeMb} MB</span>
            {emptyRegularCount > 0 && (
              <span className="text-slate-500"> · 뉴스 0건 빈 종목 {emptyRegularCount}개 제외</span>
            )}
            {activePreset === 'bot-archive' && unclassifiedNewsCount > 0 && (
              <span className="text-slate-500"> · 미분류 {unclassifiedNewsCount}건 제외</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {exportMode === 'markdown' && (
            <>
              <button
                type="button"
                onClick={handleApplyEditedMarkdown}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{applied ? '반영 완료' : '편집본 워크스페이스 반영'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>복사됨</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>전체 복사</span>
                  </>
                )}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>통합 .md 다운로드</span>
          </button>
        </div>
      </div>

      {/* Archive Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">내보내기 종목</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-50">
            {activeStocksCount.toLocaleString()}
            <span className="ml-1 text-xs font-normal text-slate-400">개</span>
          </div>
        </div>
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">포함 누적 뉴스</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-sky-400">
            {totalNews.toLocaleString()}
            <span className="ml-1 text-xs font-normal text-slate-400">건</span>
          </div>
        </div>
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">예상 파일 크기</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">
            {fileSizeMb}
            <span className="ml-1 text-xs font-normal text-slate-400">MB</span>
          </div>
        </div>
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">내보내기 제외 항목</div>
          <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-300">
            빈 종목 {emptyRegularCount.toLocaleString()}
            {activePreset === 'bot-archive' && (
              <span className="text-slate-500"> · 미분류 {unclassifiedNewsCount.toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>

      {/* Mode Switch + Format Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3.5 text-xs">
        <div className="flex items-center gap-1 rounded-lg bg-slate-950/80 p-1 border border-slate-800/80 shrink-0">
          <button
            type="button"
            onClick={() => setExportMode('markdown')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              exportMode === 'markdown'
                ? 'bg-slate-800 text-slate-100 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            통합 .md 파일 보기
          </button>
          <button
            type="button"
            onClick={() => setExportMode('telegram')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              exportMode === 'telegram'
                ? 'bg-slate-800 text-sky-400 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            <span>텔레그램 검색용 분할 ({telegramChunks.length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {exportMode === 'markdown' && (
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-400">파일 형식</span>
              <select
                value={activePreset}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    exportPreset: e.target.value as MarkdownExportPreset,
                  })
                }
                className="rounded-md border border-sky-800/70 bg-sky-950/50 px-2.5 py-1 text-xs font-semibold text-sky-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="bot-archive">텔레그램 봇 아카이브 (## ===== 종목명 =====)</option>
                <option value="standard">일반 Markdown</option>
              </select>
            </div>
          )}

          {exportMode === 'markdown' && activePreset === 'standard' && (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-400">링크 서식</span>
                <select
                  value={config.linkStyle}
                  onChange={(e) =>
                    onChangeConfig({ ...config, linkStyle: e.target.value as MarkdownLinkStyle })
                  }
                  className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="pipe-date">- 2026-11-22 | [제목](URL)</option>
                  <option value="trailing-date">- [제목](URL) (2026-11-22)</option>
                  <option value="date-grouped">### 2026-11-22 날짜별 그룹</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-400">종목 제목</span>
                <select
                  value={config.headingLevel}
                  onChange={(e) =>
                    onChangeConfig({
                      ...config,
                      headingLevel: Number(e.target.value) as MarkdownHeadingLevel,
                    })
                  }
                  className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value={1}># H1</option>
                  <option value={2}>## H2</option>
                </select>
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-400">정렬</span>
            <select
              value={config.sortOrder}
              onChange={(e) =>
                onChangeConfig({ ...config, sortOrder: e.target.value as SortOrder })
              }
              className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="asc">날짜 빠른순 (과거→최신)</option>
              <option value="desc">최신 날짜순 (최신→과거)</option>
            </select>
          </div>

          {exportMode === 'markdown' && activePreset === 'bot-archive' ? (
            <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(config.includeDateInBotTitle)}
                onChange={(e) =>
                  onChangeConfig({ ...config, includeDateInBotTitle: e.target.checked })
                }
                className="accent-sky-400"
              />
              <span>제목 앞에 날짜 표기</span>
            </label>
          ) : (
            <div className="flex flex-wrap items-center gap-3.5 text-slate-300">
              {exportMode === 'markdown' && (
                <>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeToc}
                      onChange={(e) => onChangeConfig({ ...config, includeToc: e.target.checked })}
                      className="accent-sky-400"
                    />
                    <span>종목 목차</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeHashtag}
                      onChange={(e) =>
                        onChangeConfig({ ...config, includeHashtag: e.target.checked })
                      }
                      className="accent-sky-400"
                    />
                    <span>#종목명 태그</span>
                  </label>
                </>
              )}
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeCategory}
                  onChange={(e) => onChangeConfig({ ...config, includeCategory: e.target.checked })}
                  className="accent-sky-400"
                />
                <span>분류</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeSource}
                  onChange={(e) => onChangeConfig({ ...config, includeSource: e.target.checked })}
                  className="accent-sky-400"
                />
                <span>매체</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeMemo}
                  onChange={(e) => onChangeConfig({ ...config, includeMemo: e.target.checked })}
                  className="accent-sky-400"
                />
                <span>메모</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {exportMode === 'markdown' &&
        activePreset === 'bot-archive' &&
        (unclassifiedNewsCount > 0 || emptyRegularCount > 0) && (
          <div className="rounded-xl border border-amber-800/60 bg-amber-950/35 px-5 py-3 text-xs text-amber-200 space-y-1">
            {unclassifiedNewsCount > 0 && (
              <p>
                아직 종목이 지정되지 않은 <strong>미분류 뉴스 {unclassifiedNewsCount}건</strong>은 텔레그램 봇 아카이브(`종목뉴스_전체.md`)에 포함되지 않았습니다. 종목별 정리 탭에서 종목을 지정하면 함께 포함됩니다.
              </p>
            )}
            {emptyRegularCount > 0 && (
              <p>
                기사가 아직 없는 <strong>뉴스 0건 종목 {emptyRegularCount}개</strong>는 봇 아카이브 내보내기 개수에서 제외됩니다. 뉴스를 1건 이상 추가하면 자동 포함됩니다.
              </p>
            )}
          </div>
        )}

      {exportMode === 'markdown' ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <textarea
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            rows={24}
            spellCheck={false}
            className="w-full resize-y bg-slate-900 p-5 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-3.5 text-xs text-slate-300 leading-relaxed">
            텔레그램 메시지 글자 수 제한(4,096자)에 맞춰 <span className="font-mono font-semibold text-slate-100">3,800자</span> 이내로 자동 분할했습니다.
            내 채팅방(Saved Messages)에 붙여넣어 두면 텔레그램 검색창에 <span className="font-semibold text-slate-100">종목명</span>이나 <span className="font-mono text-sky-400">#종목명</span>을 입력해 바로 찾을 수 있습니다.
          </div>

          {telegramChunks.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center text-sm text-slate-400">
              내보낼 뉴스가 있는 종목이 없습니다.
            </div>
          ) : (
            telegramChunks.map((chunk) => (
              <div
                key={chunk.index}
                className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-5 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-100">
                      파트 <span className="font-mono tabular-nums">{chunk.index}/{telegramChunks.length}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{chunk.text.length.toLocaleString()}자</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate max-w-lg text-slate-400">
                      {chunk.stockNames.join(', ')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyChunk(chunk.index, chunk.text)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    {copiedChunkIndex === chunk.index ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>파트 {chunk.index} 복사</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-slate-200">
                  {chunk.text}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
