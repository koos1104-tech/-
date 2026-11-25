import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { SAMPLE_INCOMING_NEWS_TEXT } from '../data/sampleStocks';
import { NewsCategory, ParsedMergeCandidate, StockItem } from '../types/stock';
import { parseDocumentFile } from '../utils/docParser';
import {
  NEWS_CATEGORIES,
  UNCLASSIFIED_STOCK_NAME,
  analyzeStockMatchesInText,
  checkDuplicateStatus,
  compareNewsDates,
  extractDateFromContent,
  extractDomainLabel,
  getTodayDate,
  inferCategory,
  isInvalidStockHeading,
  isMissingOrGenericTitle,
  isUnclassifiedStock,
  parseIncomingNewsText,
} from '../utils/markdownEngine';
import { SearchableStockPicker } from './SearchableStockPicker';

interface BatchMergeViewProps {
  stocks: StockItem[];
  onCommitMerge: (
    candidates: ParsedMergeCandidate[],
    newStocksToCreate: Array<{ name: string; ticker: string }>,
  ) => void;
}

export function BatchMergeView({ stocks, onCommitMerge }: BatchMergeViewProps) {
  const [rawInput, setRawInput] = useState('');
  const [defaultStockId, setDefaultStockId] = useState('');
  const [candidates, setCandidates] = useState<ParsedMergeCandidate[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isFetchingTitles, setIsFetchingTitles] = useState(false);
  const [isParsingDoc, setIsParsingDoc] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadedInfo, setUploadedInfo] = useState('');
  const [parseError, setParseError] = useState('');
  const [mergeResultMsg, setMergeResultMsg] = useState('');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'matched' | 'excluded' | 'duplicate'>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchMetaForCandidates = async (list: ParsedMergeCandidate[]) => {
    const today = getTodayDate();
    const targetUrls = Array.from(
      new Set(
        list
          .filter(
            (c) =>
              c.needsTitleFetch ||
              isMissingOrGenericTitle(c.title, c.url) ||
              !c.date ||
              c.date === today,
          )
          .map((c) => c.url),
      ),
    );
    if (targetUrls.length === 0) return;

    setIsFetchingTitles(true);
    try {
      const results: Record<string, { title?: string; date?: string; error?: string }> = {};
      for (let i = 0; i < targetUrls.length; i += 50) {
        const batch = targetUrls.slice(i, i + 50);
        try {
          const res = await fetch('/api/fetch-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: batch }),
          });
          const data = (await res.json()) as {
            results?: Record<string, { title?: string; date?: string; error?: string }>;
          };
          Object.assign(results, data.results || {});
        } catch {
          // continue on batch error
        }
      }

      setCandidates((prev) =>
        prev
          .flatMap((c) => {
            const meta = results[c.url];
            if (!meta) return [c];
            const shouldReplaceTitle =
              (c.needsTitleFetch || isMissingOrGenericTitle(c.title, c.url)) &&
              Boolean(meta.title);
            const nextTitle = shouldReplaceTitle && meta.title ? meta.title : c.title;
            const detectedDate =
              meta.date ||
              extractDateFromContent(
                `${meta.title || ''} ${c.title} ${c.memo}`,
                c.url,
              );
            const nextDate = detectedDate || c.date;
            const nextCat = c.category === '일반' ? inferCategory(nextTitle, c.url) : c.category;

            if (shouldReplaceTitle && !c.matchedStockId && !c.suggestedNewStockName) {
              const analysis = analyzeStockMatchesInText(`${nextTitle} ${c.memo}`, stocks);
              if (analysis.matched.length > 0) {
                return analysis.matched.map((m, idx) => {
                  const dup = checkDuplicateStatus(nextTitle, c.normalizedUrl, m);
                  return {
                    ...c,
                    tempId: idx === 0 ? c.tempId : `${c.tempId}_${idx}`,
                    title: nextTitle,
                    date: nextDate,
                    category: nextCat,
                    matchedStockId: m.id,
                    exclusionReason: undefined,
                    needsTitleFetch: false,
                    duplicateStatus: dup.status,
                    duplicateReason: dup.reason,
                    selected: dup.status === 'new',
                  };
                });
              }
              return [
                {
                  ...c,
                  title: nextTitle,
                  date: nextDate,
                  category: nextCat,
                  exclusionReason: analysis.exclusionReason,
                  needsTitleFetch: false,
                },
              ];
            }

            const targetStock = stocks.find((s) => s.id === c.matchedStockId);
            const dup = checkDuplicateStatus(nextTitle, c.normalizedUrl, targetStock);
            return [
              {
                ...c,
                title: nextTitle,
                date: nextDate,
                category: nextCat,
                needsTitleFetch: shouldReplaceTitle ? false : c.needsTitleFetch,
                duplicateStatus: dup.status,
                duplicateReason: dup.reason,
                selected: dup.status === 'new',
              },
            ];
          })
          .sort((a, b) => compareNewsDates(a.date, b.date, 'asc')),
      );
    } finally {
      setIsFetchingTitles(false);
    }
  };

  const handleAnalyze = (inputToParse = rawInput, fallbackStock = defaultStockId) => {
    setMergeResultMsg('');
    setParseError('');
    const parsed = parseIncomingNewsText(inputToParse, stocks, fallbackStock).sort((a, b) =>
      compareNewsDates(a.date, b.date, 'asc'),
    );
    setCandidates(parsed);
    if (parsed.length > 0) {
      void fetchMetaForCandidates(parsed);
    }
  };

  const handleFileDrop = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsParsingDoc(true);
    setParseError('');
    setMergeResultMsg('');
    const chunks: string[] = [];
    const summaries: string[] = [];

    try {
      for (const file of Array.from(files)) {
        try {
          const result = await parseDocumentFile(file, stocks);
          if (result.markdownText.trim()) {
            chunks.push(result.markdownText);
          }
          summaries.push(`${file.name} (${result.formatLabel})`);
        } catch (err) {
          setParseError(
            `${file.name} 읽기 실패: ${err instanceof Error ? err.message : '지원하지 않는 형식'}`,
          );
        }
      }

      if (chunks.length > 0) {
        const combined = rawInput.trim()
          ? `${rawInput.trim()}\n\n${chunks.join('\n\n')}`
          : chunks.join('\n\n');
        setRawInput(combined);
        setUploadedInfo(`불러온 문서: ${summaries.join(', ')}`);
        handleAnalyze(combined, defaultStockId);
      }
    } finally {
      setIsParsingDoc(false);
    }
  };

  const handleFetchMissingTitles = async () => {
    await fetchMetaForCandidates(candidates);
  };

  const updateCandidate = (tempId: string, patch: Partial<ParsedMergeCandidate>) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.tempId !== tempId) return c;
        const next = { ...c, ...patch };
        if (patch.matchedStockId !== undefined || patch.suggestedNewStockName !== undefined) {
          const targetStock = stocks.find((s) => s.id === next.matchedStockId);
          const dup = checkDuplicateStatus(
            next.title,
            next.normalizedUrl,
            targetStock,
            [],
            next.suggestedNewStockName,
          );
          next.duplicateStatus = dup.status;
          next.duplicateReason = dup.reason;
          if (next.matchedStockId || next.suggestedNewStockName.trim()) {
            next.exclusionReason = undefined;
            next.selected = dup.status === 'new';
          } else {
            next.exclusionReason = c.exclusionReason || '종목 미특정 (업종·테마 전반 또는 미등록 종목)';
          }
          if (skipDuplicates && dup.status !== 'new') {
            next.selected = false;
          }
        }
        return next;
      }),
    );
  };

  const handleToggleSkipDuplicates = (checked: boolean) => {
    setSkipDuplicates(checked);
    setCandidates((prev) =>
      prev.map((c) => ({
        ...c,
        selected: checked ? c.duplicateStatus === 'new' : true,
      })),
    );
  };

  const selectedCandidates = candidates.filter((c) => c.selected);
  const newCount = candidates.filter((c) => c.duplicateStatus === 'new').length;
  const matchedNewCount = candidates.filter(
    (c) => c.duplicateStatus === 'new' && Boolean(c.matchedStockId || c.suggestedNewStockName),
  ).length;
  const excludedCount = candidates.filter(
    (c) => c.duplicateStatus === 'new' && !c.matchedStockId && !c.suggestedNewStockName,
  ).length;
  const excludedSelectedCount = candidates.filter(
    (c) =>
      c.duplicateStatus === 'new' &&
      !c.matchedStockId &&
      !c.suggestedNewStockName &&
      c.selected,
  ).length;
  const dupCount = candidates.length - newCount;
  const visibleCandidates = candidates.filter((c) => {
    if (reviewFilter === 'matched') {
      return c.duplicateStatus === 'new' && Boolean(c.matchedStockId || c.suggestedNewStockName);
    }
    if (reviewFilter === 'excluded') {
      return c.duplicateStatus === 'new' && !c.matchedStockId && !c.suggestedNewStockName;
    }
    if (reviewFilter === 'duplicate') {
      return c.duplicateStatus !== 'new';
    }
    return true;
  });

  const handleToggleExcludedSelection = () => {
    const shouldSelect = excludedSelectedCount === 0;
    setCandidates((prev) =>
      prev.map((c) =>
        c.duplicateStatus === 'new' && !c.matchedStockId && !c.suggestedNewStockName
          ? { ...c, selected: shouldSelect }
          : c,
      ),
    );
  };
  const todayStr = getTodayDate();
  const missingTitleCount = candidates.filter(
    (c) => c.needsTitleFetch || isMissingOrGenericTitle(c.title, c.url),
  ).length;
  const missingMetaCount = candidates.filter(
    (c) =>
      c.needsTitleFetch ||
      isMissingOrGenericTitle(c.title, c.url) ||
      !c.date ||
      c.date === todayStr,
  ).length;

  const handleCommit = () => {
    if (selectedCandidates.length === 0) return;

    const newStocksMap = new Map<string, { name: string; ticker: string }>();
    for (const cand of selectedCandidates) {
      if (!cand.matchedStockId) {
        const rawName = cand.suggestedNewStockName.trim();
        const name =
          !rawName || isInvalidStockHeading(rawName) ? UNCLASSIFIED_STOCK_NAME : rawName;
        const ticker =
          name === UNCLASSIFIED_STOCK_NAME ? '' : cand.suggestedNewTicker.trim().toUpperCase();
        const key = `${name.toLowerCase()}__${ticker}`;
        if (!newStocksMap.has(key)) {
          newStocksMap.set(key, { name, ticker });
        }
      }
    }

    onCommitMerge(selectedCandidates, Array.from(newStocksMap.values()));
    setMergeResultMsg(`${selectedCandidates.length}건의 뉴스를 중복 없이 안전하게 병합했습니다.`);
    setCandidates([]);
    setRawInput('');
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            뉴스 &amp; 문서 일괄 병합
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            종목 이름과 뉴스 제목·하이퍼링크가 들어있는 `.doc` / `.docx` / `.md` 파일을 올리거나 링크를 붙여넣으면 중복을 제외하고 그대로 합쳐줍니다.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setRawInput(SAMPLE_INCOMING_NEWS_TEXT);
              setUploadedInfo('');
              handleAnalyze(SAMPLE_INCOMING_NEWS_TEXT, defaultStockId);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            <span>예시 뉴스 채우기</span>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>.doc / .docx / .md 첨부</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".doc,.docx,.md,.markdown,.txt,.html,.htm"
            multiple
            className="hidden"
            onChange={(e) => void handleFileDrop(e.target.files)}
          />
        </div>
      </div>

      {/* Direct Doc/Docx/Md Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFile(true);
        }}
        onDragLeave={() => setIsDraggingFile(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFile(false);
          void handleFileDrop(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-5 text-center transition-colors ${
          isDraggingFile
            ? 'border-sky-400 bg-sky-950/40'
            : 'border-slate-700 bg-slate-900/80 hover:border-slate-500 hover:bg-slate-900'
        }`}
      >
        {isParsingDoc ? (
          <div className="flex items-center gap-2 text-sm font-medium text-sky-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>문서에서 종목명과 하이퍼링크를 추출하는 중...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-sky-400">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="text-sm font-semibold text-slate-100">
              여기에 `.doc` / `.docx` / `.md` 파일을 끌어다 놓거나 클릭하여 추가
            </div>
            <p className="text-xs text-slate-400">
              Word 문서 본문·표 안의 종목 이름, 뉴스 제목, 하이퍼링크를 자동 추출하고 중복 링크는 제외합니다.
            </p>
          </div>
        )}
      </div>

      {uploadedInfo && (
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <FileText className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
          <span>{uploadedInfo}</span>
        </div>
      )}

      {parseError && (
        <div className="rounded-lg border border-rose-800/70 bg-rose-950/60 px-4 py-3 text-xs font-medium text-rose-200">
          {parseError}
        </div>
      )}

      {mergeResultMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-800/70 bg-emerald-950/50 px-4 py-3 text-xs font-medium text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <span>{mergeResultMsg}</span>
        </div>
      )}

      {/* Input Area */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="batch-news-input" className="text-xs font-semibold text-slate-200">
            병합할 뉴스 목록 붙여넣기 (Markdown 링크, URL만 있는 줄, &ldquo;제목 + 다음줄 URL&rdquo;, `.md` 섹션 모두 지원)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">기본 대상 종목:</span>
            <select
              value={defaultStockId}
              onChange={(e) => setDefaultStockId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="">자동 인식 (제목·헤더 기준)</option>
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.ticker ? `(${s.ticker})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <textarea
          id="batch-news-input"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          rows={7}
          placeholder={`여기에 뉴스 링크나 Markdown을 붙여넣으세요...\n예:\n- 2026-11-22 | [삼성전자, 파운드리 2나노 수주](https://www.hankyung.com/...)\nhttps://n.news.naver.com/mnews/article/...`}
          className="w-full rounded-lg border border-slate-700/80 bg-slate-950/70 p-3.5 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            URL 추적 파라미터(`utm_*` 등)는 자동 제거하여 기존 링크와 정확히 중복 비교합니다.
          </span>
          <button
            type="button"
            disabled={!rawInput.trim()}
            onClick={() => handleAnalyze()}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
          >
            목록 분석 및 중복 검사
          </button>
        </div>
      </div>

      {/* Candidate Review Summary & Table */}
      {candidates.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
            <div className="px-5 py-3">
              <div className="text-[11px] font-medium text-slate-500">추출된 전체 기사</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-slate-100">
                {candidates.length.toLocaleString()}건
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="text-[11px] font-medium text-slate-500">신규 종목 매칭</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-400">
                {matchedNewCount.toLocaleString()}건
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="text-[11px] font-medium text-slate-500">미매칭 · 종목 지정 필요</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-amber-300">
                {excludedCount.toLocaleString()}건
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="text-[11px] font-medium text-slate-500">중복 감지</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-slate-400">
                {dupCount.toLocaleString()}건
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-100 mr-1">분석 결과</span>
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setReviewFilter('all')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    reviewFilter === 'all'
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  전체 <span className="font-mono tabular-nums">{candidates.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReviewFilter('matched')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    reviewFilter === 'matched'
                      ? 'bg-slate-800 text-emerald-400 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  종목 매칭 <span className="font-mono tabular-nums">{matchedNewCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReviewFilter('excluded')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    reviewFilter === 'excluded'
                      ? 'bg-slate-800 text-amber-300 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  미매칭·제외 확인 <span className="font-mono tabular-nums">{excludedCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReviewFilter('duplicate')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    reviewFilter === 'duplicate'
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  중복 제외 <span className="font-mono tabular-nums">{dupCount}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {excludedCount > 0 && (
                <button
                  type="button"
                  onClick={handleToggleExcludedSelection}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/70 bg-amber-950/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/60 whitespace-nowrap"
                >
                  <span>
                    {excludedSelectedCount > 0
                      ? `미매칭 ${excludedSelectedCount}건 병합 제외`
                      : `미매칭 ${excludedCount}건 미분류로 포함`}
                  </span>
                </button>
              )}

              {missingMetaCount > 0 && (
                <button
                  type="button"
                  disabled={isFetchingTitles}
                  onClick={handleFetchMissingTitles}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {isFetchingTitles ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>날짜·제목 조회 중...</span>
                    </>
                  ) : (
                    <span>
                      {missingTitleCount > 0
                        ? `제목·날짜 자동 조회 (${missingMetaCount}건)`
                        : `링크에서 날짜 확인 (${missingMetaCount}건)`}
                    </span>
                  )}
                </button>
              )}

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => handleToggleSkipDuplicates(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>중복 자동 제외</span>
              </label>

              <button
                type="button"
                disabled={selectedCandidates.length === 0}
                onClick={handleCommit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
              >
                <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>선택 {selectedCandidates.length}건 병합하기</span>
              </button>
            </div>
          </div>

          {reviewFilter === 'excluded' && (
            <div className="border-b border-amber-800/60 bg-amber-950/35 px-5 py-2.5 text-xs text-amber-200">
              자동 매칭에서 빠지거나 규칙상 제외된 기사 목록입니다. 원문 링크를 확인한 뒤 오른쪽 종목 선택에서 종목을 지정하면 바로 병합 대상에 포함됩니다.
            </div>
          )}

          <div className="divide-y divide-slate-800/70">
            {visibleCandidates.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                해당 분류에 해당하는 기사가 없습니다.
              </div>
            ) : (
              visibleCandidates.map((cand) => {
              const isDup = cand.duplicateStatus !== 'new';
              const isUnmatched =
                !isDup && !cand.matchedStockId && !cand.suggestedNewStockName;
              return (
                <div
                  key={cand.tempId}
                  className={`flex flex-col gap-3 px-5 py-3.5 transition-colors lg:flex-row lg:items-center ${
                    isDup
                      ? 'bg-amber-950/20'
                      : isUnmatched
                        ? 'bg-slate-950/40 hover:bg-slate-800/50'
                        : 'hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={cand.selected}
                      onChange={(e) => updateCandidate(cand.tempId, { selected: e.target.checked })}
                      aria-label={`${cand.title} 선택`}
                      className="mt-1 h-4 w-4 accent-sky-400 shrink-0"
                    />

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {cand.duplicateStatus === 'new' ? (
                          isUnmatched ? (
                            <span className="inline-flex items-center gap-1 font-medium text-amber-300">
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{cand.exclusionReason || '미매칭 · 종목 지정 필요'}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>신규 매칭</span>
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {cand.duplicateStatus === 'duplicate-url' ? '중복 URL' : '유사 기사'}
                            </span>
                          </span>
                        )}
                        {cand.duplicateReason && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-amber-300/90">{cand.duplicateReason}</span>
                          </>
                        )}
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-slate-400">{extractDomainLabel(cand.url)}</span>
                      </div>

                      <input
                        type="text"
                        value={cand.title}
                        onChange={(e) => updateCandidate(cand.tempId, { title: e.target.value })}
                        className="w-full rounded border border-transparent bg-transparent py-0.5 text-sm font-semibold text-slate-100 hover:border-slate-700 focus:border-sky-500 focus:bg-slate-950 focus:px-2 focus:outline-none"
                      />

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <a
                          href={cand.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate max-w-md text-sky-400 hover:text-sky-300 hover:underline font-mono text-[11px]"
                        >
                          {cand.url}
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-7 lg:pl-0 shrink-0">
                    <SearchableStockPicker
                      stocks={stocks.filter((s) => !isUnclassifiedStock(s))}
                      selectedStockId={cand.matchedStockId}
                      selectedNewStockName={cand.suggestedNewStockName}
                      showSelectedLabel={true}
                      align="right"
                      placeholder="종목 검색·선택 (미지정 시 미분류)"
                      buttonClassName="min-w-[170px] border-slate-700 text-slate-200"
                      onSelectStock={(stockId) =>
                        updateCandidate(cand.tempId, {
                          matchedStockId: stockId,
                          suggestedNewStockName: '',
                        })
                      }
                      onSelectNewStock={(newName) =>
                        updateCandidate(cand.tempId, {
                          matchedStockId: '',
                          suggestedNewStockName: newName,
                        })
                      }
                      onClear={() =>
                        updateCandidate(cand.tempId, {
                          matchedStockId: '',
                          suggestedNewStockName: '',
                        })
                      }
                    />

                    <input
                      type="date"
                      value={cand.date}
                      onChange={(e) => updateCandidate(cand.tempId, { date: e.target.value })}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                    />

                    <select
                      value={cand.category}
                      onChange={(e) =>
                        updateCandidate(cand.tempId, { category: e.target.value as NewsCategory })
                      }
                      aria-label="뉴스 분류"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                    >
                      {NEWS_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
