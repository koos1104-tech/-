import { Download, Loader2, Upload } from 'lucide-react';
import { useState } from 'react';

export type ActiveTab = 'workspace' | 'merge' | 'master';

interface TopNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onOpenImport: () => void;
}

export function TopNav({ activeTab, onTabChange, onOpenImport }: TopNavProps) {
  const [isDownloadingBundle, setIsDownloadingBundle] = useState(false);
  const [bundleError, setBundleError] = useState('');

  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'workspace', label: '종목별 정리' },
    { id: 'merge', label: '뉴스 일괄 병합' },
    { id: 'master', label: '전체 Markdown' },
  ];

  const handleDownloadPcBundle = async () => {
    if (isDownloadingBundle) return;
    setIsDownloadingBundle(true);
    setBundleError('');
    try {
      const res = await fetch('/api/pc-bundle', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('설치 파일을 생성하지 못했습니다.');
      }
      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error('ZIP 파일 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 눌러 주세요.');
      }
      const blob = new Blob([buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '종목노트_PC설치.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setIsDownloadingBundle(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between gap-3 sm:gap-5 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => onTabChange('workspace')}
          className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded"
        >
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-500/12 text-sky-400"
            aria-hidden="true"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M4.5 14.5V9.5M10 14.5V5.5M15.5 14.5V8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
              <path
                d="M3.5 16.5H16.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeOpacity="0.6"
              />
            </svg>
          </span>
          <span>종목노트</span>
        </button>

        <nav className="min-w-0 flex items-center gap-3 sm:gap-5 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  isActive
                    ? 'text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-sky-400" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleDownloadPcBundle()}
            disabled={isDownloadingBundle}
            title="전체 프로젝트 소스 및 PC 실행용 ZIP 파일 다운로드"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {isDownloadingBundle ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
            )}
            <span>{isDownloadingBundle ? '준비 중...' : 'PC 설치 (.zip)'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenImport}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>파일 불러오기</span>
          </button>
        </div>
      </div>

      {bundleError && (
        <div className="border-t border-rose-900/70 bg-rose-950/60 px-6 py-2 text-xs font-medium text-rose-200">
          {bundleError}
        </div>
      )}
    </header>
  );
}
