import { FileText, Loader2, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { StockItem } from '../types/stock';
import { parseDocumentFile } from '../utils/docParser';
import {
  compareNewsDates,
  extractDateFromContent,
  inferCategory,
  isMissingOrGenericTitle,
  parseMarkdownToStocks,
} from '../utils/markdownEngine';

interface ImportModalProps {
  isOpen: boolean;
  existingStocks: StockItem[];
  onClose: () => void;
  onImport: (parsedStocks: StockItem[], mode: 'merge' | 'replace') => void;
  onClearAll: () => void;
}

export function ImportModal({
  isOpen,
  existingStocks,
  onClose,
  onImport,
  onClearAll,
}: ImportModalProps) {
  const [rawMarkdown, setRawMarkdown] = useState('');
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [excludeEmpty, setExcludeEmpty] = useState(true);
  const [autoFetchDates, setAutoFetchDates] = useState(true);
  const [isFetchingDates, setIsFetchingDates] = useState(false);
  const [fetchProgress, setFetchProgress] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allParsedStocks = useMemo(
    () => (isOpen && rawMarkdown.trim() ? parseMarkdownToStocks(rawMarkdown) : []),
    [isOpen, rawMarkdown],
  );
  const emptyParsedCount = useMemo(
    () => allParsedStocks.filter((s) => s.news.length === 0).length,
    [allParsedStocks],
  );
  const previewStocks = useMemo(
    () => (excludeEmpty ? allParsedStocks.filter((s) => s.news.length > 0) : allParsedStocks),
    [allParsedStocks, excludeEmpty],
  );
  const totalNewsCount = useMemo(
    () => previewStocks.reduce((acc, s) => acc + s.news.length, 0),
    [previewStocks],
  );
  const isLargeBulkArchive = rawMarkdown.length > 200_000;
  const missingMetaCount = useMemo(
    () =>
      previewStocks.reduce(
        (acc, s) =>
          acc +
          s.news.filter((n) =>
            isLargeBulkArchive
              ? isMissingOrGenericTitle(n.title, n.url)
              : !n.date || isMissingOrGenericTitle(n.title, n.url),
          ).length,
        0,
      ),
    [previewStocks, isLargeBulkArchive],
  );

  if (!isOpen) return null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParseError('');
    const loadedNames: string[] = [];
    const chunks: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const result = await parseDocumentFile(file, existingStocks);
        loadedNames.push(`${file.name} (${result.formatLabel})`);
        if (result.markdownText.trim()) {
          chunks.push(result.markdownText);
        }
      } catch (err) {
        setParseError(
          `${file.name} 파싱 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
        );
      }
    }

    if (loadedNames.length > 0) {
      setFileNames((prev) => [...prev, ...loadedNames]);
    }
    if (chunks.length > 0) {
      const combinedChunk = chunks.join('\n\n');
      const nextRaw = rawMarkdown.trim()
        ? `${rawMarkdown.trim()}\n\n${combinedChunk}`
        : combinedChunk;
      setAutoFetchDates(nextRaw.length <= 200_000);
      setRawMarkdown(nextRaw);
    }
  };

  const handleConfirm = async () => {
    if (previewStocks.length === 0) return;

    let finalStocks = previewStocks;

    if (autoFetchDates && missingMetaCount > 0) {
      setIsFetchingDates(true);
      try {
        const targetUrls = Array.from(
          new Set(
            previewStocks.flatMap((s) =>
              s.news
                .filter((n) => !n.date || isMissingOrGenericTitle(n.title, n.url))
                .map((n) => n.url),
            ),
          ),
        );
        const fetchedResults: Record<string, { title?: string; date?: string }> = {};

        for (let i = 0; i < targetUrls.length; i += 50) {
          setFetchProgress(
            `기사 제목·발행일 확인 중 (${Math.min(i + 50, targetUrls.length)}/${targetUrls.length})`,
          );
          const batch = targetUrls.slice(i, i + 50);
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
            // continue on batch error
          }
        }

        finalStocks = previewStocks.map((s) => {
          const updatedNews = s.news.map((n) => {
            const meta = fetchedResults[n.url];
            if (!meta) return n;
            const shouldReplaceTitle =
              isMissingOrGenericTitle(n.title, n.url) && Boolean(meta.title);
            const nextTitle = shouldReplaceTitle && meta.title ? meta.title : n.title;
            const nextCategory =
              shouldReplaceTitle && n.category === '일반'
                ? inferCategory(nextTitle, n.url)
                : n.category;
            const resolvedDate =
              n.date ||
              meta.date ||
              (meta.title ? extractDateFromContent(meta.title, n.url) : undefined) ||
              '';
            if (nextTitle !== n.title || resolvedDate !== n.date || nextCategory !== n.category) {
              return { ...n, title: nextTitle, category: nextCategory, date: resolvedDate };
            }
            return n;
          });
          return {
            ...s,
            news:
              updatedNews.length > 1 && updatedNews.every((n) => Boolean(n.date))
                ? updatedNews.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
                : updatedNews,
          };
        });
      } finally {
        setIsFetchingDates(false);
        setFetchProgress('');
      }
    }

    onImport(finalStocks, mode);
    setRawMarkdown('');
    setFileNames([]);
    setAutoFetchDates(true);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="import-modal-title" className="text-base font-bold text-slate-100">
              기존 파일(.md · .doc · .docx) 불러오기
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              종목 이름과 뉴스 제목·하이퍼링크가 담긴 Word(.doc/.docx)나 Markdown(.md) 파일을 불러오세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
              isDragging
                ? 'border-sky-400 bg-sky-950/40'
                : 'border-slate-700 bg-slate-950/60 hover:border-slate-500 hover:bg-slate-800/50'
            }`}
          >
            <Upload className="h-6 w-6 text-slate-400 mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-200">
              `.doc`, `.docx`, `.md` 파일을 드래그하거나 클릭해서 선택하세요 (복수 선택 가능)
            </p>
            <p className="mt-1 text-xs text-slate-400">
              문서 안의 종목명, 뉴스 제목, 하이퍼링크를 그대로 추출하며 중복 URL은 자동으로 제외합니다.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".doc,.docx,.md,.markdown,.txt,.html,.htm"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>

          {parseError && (
            <div className="rounded-lg border border-rose-800/70 bg-rose-950/60 px-3.5 py-2.5 text-xs font-medium text-rose-200">
              {parseError}
            </div>
          )}

          {fileNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <FileText className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
              <span>불러온 파일: {fileNames.join(', ')}</span>
            </div>
          )}

          <div>
            <label htmlFor="md-paste-input" className="block text-xs font-semibold text-slate-300 mb-1.5">
              또는 Markdown 원문 직접 붙여넣기 / 수정
            </label>
            <textarea
              id="md-paste-input"
              value={rawMarkdown}
              onChange={(e) => setRawMarkdown(e.target.value)}
              rows={8}
              placeholder={`예시:\n# 삼성전자 (005930)\n- 2026-11-20 | [차세대 HBM4 샘플 공급 확대](https://n.news.naver.com/...)\n\n# SK하이닉스 (000660)\n- [16단 HBM 장기공급계약 체결](https://www.mk.co.kr/...) (2026-11-21)`}
              className="w-full rounded-lg border border-slate-700/80 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:bg-slate-950 focus:outline-none"
            />
          </div>

          {previewStocks.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">파싱 미리보기</span>
                <span className="font-mono tabular-nums text-slate-400">
                  {previewStocks.length}개 종목 · 뉴스 {totalNewsCount}건 인식됨
                </span>
              </div>
              <div className="mt-2 max-h-28 overflow-y-auto divide-y divide-slate-800/70 text-xs">
                {previewStocks.slice(0, 100).map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-1.5">
                    <span className="font-medium text-slate-200">
                      {s.name}
                      {s.ticker ? ` (${s.ticker})` : ''}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">{s.news.length}건</span>
                  </div>
                ))}
                {previewStocks.length > 100 && (
                  <div className="py-1.5 text-center text-[11px] text-slate-400">
                    외 {(previewStocks.length - 100).toLocaleString()}개 종목 포함
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                  className="accent-sky-400"
                />
                <span>기존 종목에 합치기 (중복 URL 자동 제외)</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  className="accent-sky-400"
                />
                <span>현재 목록을 새로 덮어쓰기</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeEmpty}
                  onChange={(e) => setExcludeEmpty(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>
                  0건 항목 제외{emptyParsedCount > 0 ? ` (${emptyParsedCount}건)` : ''}
                </span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoFetchDates}
                  onChange={(e) => setAutoFetchDates(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>
                  링크에서 제목·실제 날짜 자동 조회
                  {isLargeBulkArchive
                    ? ' (대용량 아카이브는 기존 제목·순서 유지)'
                    : missingMetaCount > 0
                      ? ` (${missingMetaCount}건)`
                      : ''}
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                onClearAll();
                onClose();
              }}
              className="text-xs font-medium text-rose-400 hover:underline"
            >
              저장된 종목 전체 비우기
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-3.5">
          <button
            type="button"
            disabled={isFetchingDates}
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800/70 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={previewStocks.length === 0 || isFetchingDates}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isFetchingDates ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>{fetchProgress || '기사 제목·발행일 확인 중...'}</span>
              </>
            ) : previewStocks.length > 0 ? (
              <span>{previewStocks.length}개 종목 가져오기</span>
            ) : (
              <span>가져올 Markdown을 입력하세요</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
