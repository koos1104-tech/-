import {
  DuplicateStatus,
  MarkdownFormatConfig,
  MarketType,
  NewsCategory,
  NewsEntry,
  ParsedMergeCandidate,
  StockItem,
} from '../types/stock';

export const NEWS_CATEGORIES: NewsCategory[] = [
  '실적/가이던스',
  '공시/지분',
  '수주/계약',
  '신사업/R&D',
  '주주환원',
  '업황/리포트',
  '일반',
];

export const DEFAULT_MD_CONFIG: MarkdownFormatConfig = {
  exportPreset: 'bot-archive',
  includeDateInBotTitle: false,
  headingLevel: 2,
  linkStyle: 'pipe-date',
  includeSource: true,
  includeCategory: true,
  includeMemo: true,
  includeToc: true,
  includeHashtag: true,
  sortOrder: 'asc',
};

export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getTodayDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'igshid',
      'ref',
      'from',
      'nclick_key',
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }
    parsed.hash = '';
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '') || '';
    const search = parsed.searchParams.toString();
    return `${host}${pathname}${search ? `?${search}` : ''}`;
  } catch {
    return trimmed.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  }
}

export const UNCLASSIFIED_STOCK_NAME = '미분류 뉴스';

export function normalizeStockNameKey(name: string): string {
  return name.toLowerCase().replace(/[\s,·]+/g, '').trim();
}

export function stripDecorativeDividers(raw: string): string {
  if (!raw) return '';
  const parts = raw.split(/(https?:\/\/[^\s<>()]+)/gi);
  const cleaned = parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part
        .replace(/(?:^|\s)[=＝═─━―_*~](?:\s+[=＝═─━―_*~]){2,}(?=\s|$)/g, ' ')
        .replace(/[=＝═─━―]{2,}|[-*~_]{3,}/g, ' ')
        .replace(/[═─━―]+/g, ' ');
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.replace(/^[·\s]+|[·\s]+$/g, '').trim();
}

export function isHtmlOrNoiseLine(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  const withoutTags = t
    .replace(/<\/?[a-z][a-z0-9:_-]*(?:\s+[^>]*)?\/?>/gi, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, ' ')
    .trim();
  if (!withoutTags) return true;
  const compact = withoutTags.replace(/\s+/g, '');
  if (!compact) return true;
  if (/^[-*_=＝~•·.|\\/─━═―—–■□◆◇●○★☆▪▫‣⁃※:;,#]+$/.test(compact)) return true;
  if (/^\(\s*\)|\[\s*\]$/.test(withoutTags)) return true;
  return false;
}

export function isInvalidStockHeading(raw: string): boolean {
  const t = stripDecorativeDividers(
    raw.replace(/^\s*(?:[-*+•▪▶◆■●○★☆※📌📰]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, ''),
  ).trim();
  if (!t) return true;
  if (isHtmlOrNoiseLine(t)) return true;
  if (/<\/?[a-z][^>]*>/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (isStandaloneDateLine(t)) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  return /^(?:미분류(?:\s*(?:종목|뉴스))?|구분\s*필요|분류\s*대기|기타|no\.?|번호|순번|구분|날짜|일자|종목|종목명|기업명|회사명|제목|기사제목|뉴스|뉴스제목|뉴스내용|내용|링크|하이퍼링크|url|비고|메모|출처|br|hr|div|span|nbsp|제목\s*없음)$/i.test(
    t,
  );
}

export function isUnclassifiedStock(stock: Pick<StockItem, 'name'>): boolean {
  const n = stock.name.trim();
  return n === UNCLASSIFIED_STOCK_NAME || isInvalidStockHeading(n);
}

export function isMissingOrGenericTitle(title: string, url = ''): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (url && normalizeUrl(t) === normalizeUrl(url)) return true;
  return /^(?:\[?\s*(?:링크|기사|기사링크|기사보기|원문|원문보기|뉴스|뉴스링크|바로가기|클릭|보기|url|link|source|more|read more|제목\s*없음)\s*\]?)$/i.test(
    t,
  );
}

const DOMAIN_LABEL_MAP: Array<[RegExp, string]> = [
  [/n\.news\.naver\.com|news\.naver\.com|finance\.naver\.com/i, '네이버뉴스'],
  [/dart\.fss\.or\.kr|kind\.krx\.co\.kr/i, 'DART 공시'],
  [/hankyung\.com/i, '한국경제'],
  [/mk\.co\.kr/i, '매일경제'],
  [/sedaily\.com/i, '서울경제'],
  [/edaily\.co\.kr/i, '이데일리'],
  [/fnnews\.com/i, '파이낸셜뉴스'],
  [/mt\.co\.kr/i, '머니투데이'],
  [/biz\.chosun\.com|chosun\.com/i, '조선비즈'],
  [/yna\.co\.kr/i, '연합뉴스'],
  [/etnews\.com/i, '전자신문'],
  [/zdnet\.co\.kr/i, '지디넷코리아'],
  [/thebell\.co\.kr/i, '더벨'],
  [/investchosun\.com/i, '인베스트조선'],
  [/v\.daum\.net|daum\.net/i, '다음뉴스'],
  [/asiae\.co\.kr/i, '아시아경제'],
  [/newsis\.com/i, '뉴시스'],
  [/news1\.kr/i, '뉴스1'],
  [/bloomberg\.com/i, 'Bloomberg'],
  [/reuters\.com/i, 'Reuters'],
  [/wsj\.com/i, 'WSJ'],
  [/ft\.com/i, 'Financial Times'],
  [/sec\.gov/i, 'SEC Filing'],
  [/youtube\.com|youtu\.be/i, 'YouTube'],
];

export function extractDomainLabel(rawUrl: string): string {
  if (!rawUrl) return '링크';
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    for (const [pattern, label] of DOMAIN_LABEL_MAP) {
      if (pattern.test(host)) {
        return label;
      }
    }
    return host;
  } catch {
    return '웹링크';
  }
}

export function inferCategory(title: string, url = ''): NewsCategory {
  const target = `${title} ${url}`.toLowerCase();
  if (/dart\.fss\.or\.kr|공시|지분|최대주주|유상증자|전환사채|cb|bw|임원|취득|처분/i.test(target)) {
    return '공시/지분';
  }
  if (/실적|영업이익|매출|컨센서스|어닝|잠정|가이던스|흑자전환|적자|분기|opm/i.test(target)) {
    return '실적/가이던스';
  }
  if (/수주|계약|공급|납품|협약|mou|수출|턴키|선정|파트너십/i.test(target)) {
    return '수주/계약';
  }
  if (/배당|자사주|소각|밸류업|주주환원|무상증자|액면분할/i.test(target)) {
    return '주주환원';
  }
  if (/신제품|양산|개발|임상|특허|ai|hbm|차세대|투자|증설|공장|라인|rnd|r&d/i.test(target)) {
    return '신사업/R&D';
  }
  if (/리포트|목표주가|투자의견|업황|전망|사이클|단가|스팟|수요|출하량/i.test(target)) {
    return '업황/리포트';
  }
  return '일반';
}

export function extractDateFromContent(
  text: string,
  url = '',
  fallbackDate?: string,
): string | undefined {
  const clean = text.trim();
  const baseYear = (fallbackDate || getTodayDate()).slice(0, 4);

  if (clean) {
    // 1. YYYY-MM-DD / YYYY. MM. DD / YYYY년 MM월 DD일
    const fullMatch = clean.match(
      /(20\d{2})\s*[.\-/년]\s*(0?[1-9]|1[0-2])\s*[.\-/월]\s*(0?[1-9]|[12]\d|3[01])(?:\s*일)?/,
    );
    if (fullMatch) {
      return `${fullMatch[1]}-${fullMatch[2].padStart(2, '0')}-${fullMatch[3].padStart(2, '0')}`;
    }

    // 2. 8-digit YYYYMMDD in text (not part of longer numbers)
    const compactMatch = clean.match(
      /(?:^|[^\d])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^\d]|$)/,
    );
    if (compactMatch) {
      return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
    }

    // 3. YY.MM.DD / YY-MM-DD / YY/MM/DD
    const shortMatch = clean.match(
      /(?:^|[^\d])([12]\d)\s*[.\-/]\s*(0?[1-9]|1[0-2])\s*[.\-/]\s*(0?[1-9]|[12]\d|3[01])\.?(?:[^\d]|$)/,
    );
    if (shortMatch) {
      return `20${shortMatch[1]}-${shortMatch[2].padStart(2, '0')}-${shortMatch[3].padStart(2, '0')}`;
    }

    // 4. Korean M월 D일
    const korMdMatch = clean.match(/(0?[1-9]|1[0-2])\s*월\s*(0?[1-9]|[12]\d|3[01])\s*일/);
    if (korMdMatch) {
      const mm = korMdMatch[1].padStart(2, '0');
      const dd = korMdMatch[2].padStart(2, '0');
      const candidate = `${baseYear}-${mm}-${dd}`;
      if (!fallbackDate && candidate > getTodayDate()) {
        return `${Number(baseYear) - 1}-${mm}-${dd}`;
      }
      return candidate;
    }

    // 5. Bracketed or standalone M/D or M.D (e.g. [11/22], (11.22), 11/22 )
    const mdMatch = clean.match(
      /(?:^|[\s\[(])(0?[1-9]|1[0-2])[./](0?[1-9]|[12]\d|3[01])(?=[\s\])|,|·|\-|:|$])/,
    );
    if (mdMatch) {
      const mm = mdMatch[1].padStart(2, '0');
      const dd = mdMatch[2].padStart(2, '0');
      const candidate = `${baseYear}-${mm}-${dd}`;
      if (!fallbackDate && candidate > getTodayDate()) {
        return `${Number(baseYear) - 1}-${mm}-${dd}`;
      }
      return candidate;
    }

    // 6. English month DD, YYYY (e.g. Nov 15, 2026)
    const engMatch = clean.match(
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i,
    );
    if (engMatch) {
      const monthMap: Record<string, string> = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
      };
      const m = monthMap[engMatch[1].slice(0, 3).toLowerCase()];
      if (m) {
        return `${engMatch[3]}-${m}-${engMatch[2].padStart(2, '0')}`;
      }
    }
  }

  // 7. Date inside URL (e.g., /2026/11/19/, rcpNo=20261114..., AKR20261122...)
  if (url) {
    const urlSepMatch = url.match(
      /(20\d{2})[\/\-](0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])/,
    );
    if (urlSepMatch) {
      return `${urlSepMatch[1]}-${urlSepMatch[2]}-${urlSepMatch[3]}`;
    }
    const urlCompactMatch = url.match(
      /(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/,
    );
    if (urlCompactMatch) {
      return `${urlCompactMatch[1]}-${urlCompactMatch[2]}-${urlCompactMatch[3]}`;
    }
  }

  return undefined;
}

export function isStandaloneDateLine(raw: string): boolean {
  const stripped = raw
    .trim()
    .replace(/^[\[(]+|[\])]+$/g, '')
    .replace(/\s*\([월화수목금토일](?:요일)?\)\s*$/, '')
    .replace(/\s+(?:오전|오후)?\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '')
    .trim();
  if (!stripped || /https?:\/\//i.test(stripped)) return false;

  return (
    /^(20\d{2})\s*[.\-/년]\s*(0?[1-9]|1[0-2])\s*[.\-/월]\s*(0?[1-9]|[12]\d|3[01])(?:\s*일)?\.?$/.test(
      stripped,
    ) ||
    /^([12]\d)\s*[.\-/]\s*(0?[1-9]|1[0-2])\s*[.\-/]\s*(0?[1-9]|[12]\d|3[01])\.?$/.test(stripped) ||
    /^(0?[1-9]|1[0-2])\s*월\s*(0?[1-9]|[12]\d|3[01])\s*일\.?$/.test(stripped) ||
    /^(0?[1-9]|1[0-2])[./](0?[1-9]|[12]\d|3[01])\.?$/.test(stripped) ||
    /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(stripped)
  );
}

export function compareNewsDates(
  dateA: string,
  dateB: string,
  order: 'asc' | 'desc' = 'asc',
): number {
  if (!dateA && !dateB) return 0;
  if (!dateA) return 1;
  if (!dateB) return -1;
  const cmp = dateA.localeCompare(dateB);
  return order === 'desc' ? -cmp : cmp;
}

export function consolidateUnclassifiedStocks(stocks: StockItem[]): StockItem[] {
  const regular: StockItem[] = [];
  const regularIdxByName = new Map<string, number>();
  const regularIdxByKrxTicker = new Map<string, number>();
  const unclassifiedNews: NewsEntry[] = [];
  let existingBucket: StockItem | undefined;
  const seenUrls = new Set<string>();

  for (const s of stocks) {
    const cleanedName = stripDecorativeDividers(s.name);
    if (isUnclassifiedStock({ name: cleanedName })) {
      if (cleanedName === UNCLASSIFIED_STOCK_NAME && !existingBucket) {
        existingBucket = s;
      }
      for (const n of s.news) {
        const cleanTitle = stripDecorativeDividers(
          n.title.replace(/<\/?br\s*\/?>/gi, ' '),
        );
        const cleanMemo = stripDecorativeDividers(
          n.memo.replace(/<\/?br\s*\/?>/gi, ' '),
        );
        const norm = n.normalizedUrl || normalizeUrl(n.url);
        if (norm && seenUrls.has(norm)) continue;
        if (norm) seenUrls.add(norm);
        unclassifiedNews.push({
          ...n,
          title: cleanTitle || cleanMemo || n.url,
          memo: cleanTitle ? cleanMemo : '',
          normalizedUrl: norm,
        });
      }
    } else {
      const nameKey = normalizeStockNameKey(cleanedName);
      const krxTickerKey = /^\d{6}$/.test(s.ticker.trim()) ? s.ticker.trim() : '';
      const existingIdx =
        (krxTickerKey ? regularIdxByKrxTicker.get(krxTickerKey) : undefined) ??
        regularIdxByName.get(nameKey);
      if (existingIdx === undefined) {
        const idx = regular.length;
        const item = cleanedName !== s.name ? { ...s, name: cleanedName } : s;
        regular.push(item);
        regularIdxByName.set(nameKey, idx);
        if (krxTickerKey) regularIdxByKrxTicker.set(krxTickerKey, idx);
      } else {
        const target = regular[existingIdx];
        const existingUrls = new Set(target.news.map((n) => n.normalizedUrl).filter(Boolean));
        const mergedNews = [
          ...target.news,
          ...s.news.filter((n) => {
            if (!n.normalizedUrl) return true;
            if (existingUrls.has(n.normalizedUrl)) return false;
            existingUrls.add(n.normalizedUrl);
            return true;
          }),
        ];
        const sortedNews =
          mergedNews.length > 1 && mergedNews.every((n) => Boolean(n.date))
            ? [...mergedNews].sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
            : mergedNews;
        regular[existingIdx] = {
          ...target,
          summaryNote: target.summaryNote || s.summaryNote,
          news: sortedNews,
        };
      }
    }
  }

  if (unclassifiedNews.length === 0) {
    return regular;
  }

  unclassifiedNews.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'));
  const bucket: StockItem = existingBucket
    ? {
        ...existingBucket,
        name: UNCLASSIFIED_STOCK_NAME,
        ticker: '',
        market: '미분류',
        sector: '구분 필요',
        news: unclassifiedNews,
      }
    : {
        id: createId('stk'),
        name: UNCLASSIFIED_STOCK_NAME,
        ticker: '',
        market: '미분류',
        sector: '구분 필요',
        aliases: [],
        summaryNote: '문서나 링크에서 종목이 자동 구분되지 않은 뉴스 모음입니다. 원하는 종목으로 이동해 주세요.',
        news: unclassifiedNews,
        updatedAt: new Date().toISOString(),
      };

  return [...regular, bucket];
}

export function reextractNewsDates(
  stocks: StockItem[],
  clearUnverifiedToday = false,
): StockItem[] {
  const today = getTodayDate();
  const updated = stocks.map((s) => {
    const cleanedStockName = stripDecorativeDividers(s.name);
    const cleanedSummary = s.summaryNote
      ? s.summaryNote
          .split(/\r?\n/)
          .map((line) => stripDecorativeDividers(line))
          .filter(Boolean)
          .join('\n')
      : '';

    const mappedNews = s.news.map((n) => {
      const cleanedTitle = stripDecorativeDividers(
        n.title.replace(/<\/?br\s*\/?>/gi, ' '),
      );
      const cleanedMemo = stripDecorativeDividers(
        n.memo.replace(/<\/?br\s*\/?>/gi, ' '),
      );
      let next: NewsEntry =
        cleanedTitle !== n.title || cleanedMemo !== n.memo
          ? {
              ...n,
              title: cleanedTitle || n.url,
              memo: cleanedMemo,
            }
          : n;

      if (isMissingOrGenericTitle(next.title, next.url) && next.memo.trim()) {
        const promotedTitle = next.memo.trim();
        next = {
          ...next,
          title: promotedTitle,
          memo: '',
          category:
            next.category === '일반'
              ? inferCategory(promotedTitle, next.url)
              : next.category,
        };
      }
      const detected = extractDateFromContent(`${next.title} ${next.memo}`, next.url);
      if (detected && (!next.date || next.date === today)) {
        return detected !== next.date ? { ...next, date: detected } : next;
      }
      if (clearUnverifiedToday && next.date === today && !detected) {
        return { ...next, date: '' };
      }
      return next;
    });

    return {
      ...s,
      name: cleanedStockName,
      summaryNote: cleanedSummary,
      news:
        mappedNews.length > 1 && mappedNews.every((n) => Boolean(n.date))
          ? [...mappedNews].sort((a, b) => compareNewsDates(a.date, b.date, 'asc'))
          : mappedNews,
    };
  });
  return consolidateUnclassifiedStocks(updated);
}

export function normalizeDateString(raw?: string): string {
  if (!raw) return '';
  return extractDateFromContent(raw) || '';
}

function normalizeTitleForCompare(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

export function checkDuplicateStatus(
  title: string,
  normalizedUrl: string,
  targetStock: StockItem | undefined,
  pendingInBatch: Array<{ normalizedUrl: string; title: string; stockId: string; newStockName?: string }> = [],
  newStockName = '',
): { status: DuplicateStatus; reason?: string } {
  const normNewTitle = normalizeTitleForCompare(title);

  if (!targetStock) {
    const inBatchUrl = pendingInBatch.find((b) => normalizedUrl && b.normalizedUrl === normalizedUrl);
    if (inBatchUrl) {
      return { status: 'duplicate-url', reason: '입력 목록 내 중복 URL' };
    }
    if (normNewTitle.length >= 6) {
      const inBatchTitle = pendingInBatch.find((b) => {
        const sameTarget =
          !newStockName ||
          !b.newStockName ||
          b.newStockName.toLowerCase() === newStockName.toLowerCase();
        if (!sameTarget) return false;
        const existingNorm = normalizeTitleForCompare(b.title);
        return existingNorm && (existingNorm === normNewTitle || existingNorm.includes(normNewTitle) || normNewTitle.includes(existingNorm));
      });
      if (inBatchTitle) {
        return { status: 'similar-title', reason: '입력 목록 내 유사 기사 존재' };
      }
    }
    return { status: 'new' };
  }

  if (normalizedUrl) {
    const exactUrl = targetStock.news.find((n) => n.normalizedUrl === normalizedUrl);
    if (exactUrl) {
      return { status: 'duplicate-url', reason: `이미 등록됨 (${exactUrl.date})` };
    }
    const batchUrl = pendingInBatch.find(
      (b) => b.stockId === targetStock.id && b.normalizedUrl === normalizedUrl,
    );
    if (batchUrl) {
      return { status: 'duplicate-url', reason: '이번 병합 목록 내 중복 URL' };
    }
  }

  if (normNewTitle.length >= 6) {
    const similar = targetStock.news.find((n) => {
      const existingNorm = normalizeTitleForCompare(n.title);
      if (!existingNorm) return false;
      return existingNorm === normNewTitle || existingNorm.includes(normNewTitle) || normNewTitle.includes(existingNorm);
    });
    if (similar) {
      return { status: 'similar-title', reason: `유사 기사 존재: "${similar.title.slice(0, 26)}..."` };
    }
    const batchSimilar = pendingInBatch.find((b) => {
      if (b.stockId !== targetStock.id) return false;
      const existingNorm = normalizeTitleForCompare(b.title);
      return existingNorm && (existingNorm === normNewTitle || existingNorm.includes(normNewTitle) || normNewTitle.includes(existingNorm));
    });
    if (batchSimilar) {
      return { status: 'similar-title', reason: '이번 병합 목록 내 유사 기사 존재' };
    }
  }

  return { status: 'new' };
}

export function parseStockHeading(headingText: string): {
  name: string;
  ticker: string;
  market: MarketType;
  sector: string;
} {
  let clean = stripDecorativeDividers(headingText);
  let market: MarketType = '미분류';
  let sector = '';

  // Optional market/sector after pipe e.g. "삼성전자 (005930) | KOSPI · 반도체"
  const pipeIdx = clean.indexOf('|');
  if (pipeIdx !== -1) {
    const metaPart = clean.slice(pipeIdx + 1).trim();
    clean = clean.slice(0, pipeIdx).trim();
    if (/kospi|코스피/i.test(metaPart)) market = 'KOSPI';
    else if (/kosdaq|코스닥/i.test(metaPart)) market = 'KOSDAQ';
    else if (/nasdaq|nyse|해외|미국/i.test(metaPart)) market = '해외';

    const parts = metaPart
      .split(/[·/,]/)
      .map((s) => s.trim())
      .filter(
        (s) =>
          s &&
          !s.startsWith('#') &&
          !/^(kospi|kosdaq|코스피|코스닥|nasdaq|nyse|해외|미분류)$/i.test(s),
      );
    if (parts.length > 0) {
      sector = parts[0];
    }
  }
  clean = clean.replace(/\s+#[^\s]+/g, '').trim();

  // Extract ticker in parentheses or brackets e.g. "삼성전자 (005930)" or "NVIDIA [NVDA]"
  // Ignore generic short/numeric tags like (1), (2), (A), (US), (ETF), (SPAC)
  let ticker = '';
  const nonTickerTags = new Set([
    'US',
    'KR',
    'JP',
    'CN',
    'HK',
    'EU',
    'UK',
    'ETF',
    'ETN',
    'ADR',
    'GDR',
    'SPAC',
    'REIT',
    'OLD',
    'NEW',
    'HOLD',
    'INC',
    'CO',
    'CORP',
    'LTD',
    'PLC',
  ]);
  const tickerMatch = clean.match(/[\[(](\d{6}|[A-Z]{2,5}(?:\.[A-Z]{1,2})?)[\])]\s*$/);
  if (tickerMatch && !nonTickerTags.has(tickerMatch[1].toUpperCase())) {
    ticker = tickerMatch[1].toUpperCase();
    clean = clean.slice(0, tickerMatch.index).trim();
  } else {
    const trailingCode = clean.match(/\s+(\d{6})$/);
    if (trailingCode) {
      ticker = trailingCode[1];
      clean = clean.slice(0, trailingCode.index).trim();
    }
  }

  if (market === '미분류' && ticker) {
    if (/^[A-Z.]{1,5}$/.test(ticker)) {
      market = '해외';
    } else if (/^\d{6}$/.test(ticker)) {
      market = 'KOSPI';
    }
  }

  return { name: clean || headingText.trim(), ticker, market, sector };
}

function parseNewsLine(line: string, contextDate: string): Omit<NewsEntry, 'id' | 'addedAt'> | null {
  const trimmed = line.replace(/^\s*(?:[-*+•▪▶◆■●○★☆※📌📰]|\d+\.)\s*/, '').trim();
  if (!trimmed) return null;

  // Look for Markdown link: [title](url), supporting nested [특징주] brackets and optional <url> / "title"
  const mdLinkMatch =
    trimmed.match(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\(<?(https?:\/\/[^)>\s]+)>?(?:\s+"[^"]*")?\)/) ||
    trimmed.match(/\[(.*?)\]\(<?(https?:\/\/[^)>\s]+)>?(?:\s+"[^"]*")?\)/);
  if (mdLinkMatch) {
    const rawMdTitle = mdLinkMatch[1].trim();
    const url = mdLinkMatch[2].trim();
    const afterLink = trimmed.slice((mdLinkMatch.index ?? 0) + mdLinkMatch[0].length).trim();
    const beforeLink = trimmed.slice(0, mdLinkMatch.index ?? 0).trim();
    const today = getTodayDate();
    const prefixDate = extractDateFromContent(beforeLink, '', contextDate || undefined);
    const innerDate = extractDateFromContent(`${rawMdTitle} ${afterLink}`, url, contextDate || undefined);
    const date =
      prefixDate && (prefixDate !== today || !innerDate)
        ? prefixDate
        : innerDate || prefixDate || contextDate;

    // Extract optional memo & source/category hints
    const memoParts = afterLink
      .replace(/^\(?\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\)?/, '')
      .replace(/^[|\-–—·:\s]+/, '')
      .trim();

    let source = extractDomainLabel(url);
    let category: NewsCategory = inferCategory(rawMdTitle, url);

    // Check bracket tags like [실적/가이던스] or [한국경제]
    const bracketTags = Array.from(beforeLink.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]);
    for (const tag of bracketTags) {
      const matchedCat = NEWS_CATEGORIES.find((c) => c === tag || c.includes(tag));
      if (matchedCat) category = matchedCat;
      else if (tag.length <= 15 && !/\d{4}/.test(tag)) source = tag;
    }

    const cleanedBefore = beforeLink
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/(20\d{2})\s*[.\-/년]\s*(0?[1-9]|1[0-2])\s*[.\-/월]\s*(0?[1-9]|[12]\d|3[01])(?:\s*일)?\.?/g, ' ')
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/^[|\-–—·:\s]+|[|\-–—·:\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Parse pipe segments in afterLink
    const cleanedAfter = memoParts
      .split(/\s+\|\s+/)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        const matchedCat = NEWS_CATEGORIES.find((c) => c === s);
        if (matchedCat) {
          category = matchedCat;
          return false;
        }
        if (s === source) return false;
        return true;
      });

    let title = stripDecorativeDividers(rawMdTitle) || rawMdTitle;
    let memo = '';

    if (isMissingOrGenericTitle(title, url)) {
      if (cleanedBefore) {
        title = stripDecorativeDividers(cleanedBefore) || cleanedBefore;
        memo = stripDecorativeDividers(cleanedAfter.join(' · '));
      } else if (cleanedAfter.length > 0) {
        title = stripDecorativeDividers(cleanedAfter[0]) || cleanedAfter[0];
        memo = stripDecorativeDividers(cleanedAfter.slice(1).join(' · '));
      }
    } else {
      const memoSegments = [
        cleanedBefore && cleanedBefore !== title ? stripDecorativeDividers(cleanedBefore) : '',
        ...cleanedAfter.map((s) => stripDecorativeDividers(s)),
      ].filter(Boolean);
      memo = memoSegments.join(' · ');
    }

    if (category === '일반') {
      category = inferCategory(`${title} ${memo}`, url);
    }

    return {
      title,
      url,
      normalizedUrl: normalizeUrl(url),
      date,
      source,
      category,
      memo,
    };
  }

  // Bare URL in line
  const urlMatch = trimmed.match(/(https?:\/\/[^\s<>()]+)/);
  if (urlMatch) {
    const url = urlMatch[1].replace(/[.,;]+$/, '');
    const withoutDateAndUrl = trimmed
      .replace(urlMatch[0], '')
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g, '')
      .replace(/^[|\-–—·:\s]+|[|\-–—·:\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const title = stripDecorativeDividers(withoutDateAndUrl) || url;
    const date = extractDateFromContent(trimmed, url, contextDate) || contextDate;
    return {
      title,
      url,
      normalizedUrl: normalizeUrl(url),
      date,
      source: extractDomainLabel(url),
      category: inferCategory(title, url),
      memo: '',
    };
  }

  return null;
}

function parseNewsLineAll(
  line: string,
  contextDate: string,
): Array<Omit<NewsEntry, 'id' | 'addedAt'>> {
  const linkRegex =
    /\[((?:[^\[\]]|\[[^\]]*\])*)\]\(<?(https?:\/\/[^)>\s]+)>?(?:\s+"[^"]*")?\)/g;
  const matches = Array.from(line.matchAll(linkRegex));
  if (matches.length <= 1) {
    const single = parseNewsLine(line, contextDate);
    return single ? [single] : [];
  }
  const results: Array<Omit<NewsEntry, 'id' | 'addedAt'>> = [];
  for (const m of matches) {
    const single = parseNewsLine(m[0], contextDate);
    if (single) results.push(single);
  }
  return results;
}

export function parseMarkdownToStocks(
  markdown: string,
  fallbackStockName = UNCLASSIFIED_STOCK_NAME,
): StockItem[] {
  const lines = markdown.split(/\r?\n|<\/?br\s*\/?>/gi);
  const stocks: StockItem[] = [];
  const stockByTicker = new Map<string, StockItem>();
  const stockByName = new Map<string, StockItem>();
  let currentStock: StockItem | null = null;
  let contextDate = '';
  let pendingTextLines: string[] = [];
  let inFrontmatter = false;
  const seenUrlsPerStock = new Map<string, Set<string>>();

  const ensureCurrentStock = (headingText?: string): StockItem => {
    const rawHeading = headingText || fallbackStockName;
    const effectiveHeading = isInvalidStockHeading(rawHeading)
      ? UNCLASSIFIED_STOCK_NAME
      : rawHeading;
    const parsed = parseStockHeading(effectiveHeading);
    const krxTicker = /^\d{6}$/.test(parsed.ticker) ? parsed.ticker : '';
    const nameKey = normalizeStockNameKey(parsed.name);
    const existing =
      (krxTicker ? stockByTicker.get(krxTicker) : undefined) ||
      stockByName.get(nameKey);
    if (existing) {
      return existing;
    }
    const newStock: StockItem = {
      id: createId('stk'),
      name: parsed.name,
      ticker: parsed.ticker,
      market: parsed.name === UNCLASSIFIED_STOCK_NAME ? '미분류' : parsed.market,
      sector: parsed.name === UNCLASSIFIED_STOCK_NAME ? '구분 필요' : parsed.sector,
      aliases: [],
      summaryNote: '',
      news: [],
      updatedAt: new Date().toISOString(),
    };
    stocks.push(newStock);
    if (krxTicker) stockByTicker.set(krxTicker, newStock);
    stockByName.set(nameKey, newStock);
    seenUrlsPerStock.set(newStock.id, new Set());
    contextDate = '';
    return newStock;
  };

  const looksLikeYamlStart = (idx: number): boolean => {
    for (let j = idx + 1; j < Math.min(idx + 4, lines.length); j++) {
      const next = lines[j].trim();
      if (!next) continue;
      return /^(?:date|created|updated|categories|tags|title)\s*:/i.test(next);
    }
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (inFrontmatter) {
      if (/^---+$/.test(line)) {
        inFrontmatter = false;
        continue;
      }
      if (
        !line ||
        (/^(?:date|created|updated|categories|tags|title)\s*:/i.test(line) && !/https?:\/\//i.test(line)) ||
        (/^-\s+[^\[\]]+$/.test(line) && !/https?:\/\//i.test(line))
      ) {
        continue;
      }
      inFrontmatter = false;
    }

    if (/^---+$/.test(line) && looksLikeYamlStart(i)) {
      inFrontmatter = true;
      pendingTextLines = [];
      continue;
    }

    if (!line || isHtmlOrNoiseLine(line)) {
      pendingTextLines = [];
      continue;
    }

    // Horizontal rule resets buffered text
    if (/^[-*_=`─━═]{3,}$/.test(line.replace(/\s+/g, ''))) {
      pendingTextLines = [];
      continue;
    }

    // Top-level or secondary stock heading (# or ##)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      pendingTextLines = [];
      const level = headingMatch[1].length;
      const content = stripDecorativeDividers(headingMatch[2]);
      if (!content) continue;

      // Check if ### is actually a date subheading like ### 2026-11-22 or ### 11월 15일
      if (level >= 2 && isStandaloneDateLine(content)) {
        contextDate = normalizeDateString(content);
        continue;
      }

      // Skip generic document header like "# 상장사 뉴스 정리" or TOC heading "## 종목 목차"
      if (
        (level === 1 &&
          stocks.length === 0 &&
          /뉴스|정리|관심종목|리서치|포트폴리오|stock|watchlist/i.test(content) &&
          !/[\[(][A-Za-z0-9]{2,10}[\])]/.test(content)) ||
        /^(?:종목\s*목차|목차|table of contents)$/i.test(content)
      ) {
        continue;
      }

      if (isInvalidStockHeading(content)) {
        currentStock = ensureCurrentStock(UNCLASSIFIED_STOCK_NAME);
        contextDate = '';
        continue;
      }

      if (level <= 2 || !currentStock) {
        currentStock = ensureCurrentStock(content);
        contextDate = '';
        continue;
      }

      // Level 3 heading inside a stock: could be date or sub-section, check if date
      const subDate = extractDateFromContent(content, '', contextDate);
      if (subDate) {
        contextDate = subDate;
      }
      continue;
    }

    // Standalone date line inside stock section
    if (isStandaloneDateLine(line)) {
      contextDate = normalizeDateString(line);
      continue;
    }

    // Blockquote note for stock (> 투자 포인트: ...)
    if (line.startsWith('>')) {
      pendingTextLines = [];
      const target: StockItem = currentStock ?? ensureCurrentStock(fallbackStockName);
      currentStock = target;
      const quoteText = stripDecorativeDividers(line.replace(/^>\s*/, ''));
      if (quoteText) {
        target.summaryNote = target.summaryNote
          ? `${target.summaryNote}\n${quoteText}`
          : quoteText;
      }
      continue;
    }

    // Try parsing as a news link line (supports multiple links on one line)
    const parsedNewsList = parseNewsLineAll(line, contextDate);
    if (parsedNewsList.length > 0) {
      let pendingRaw = '';
      let pendingConsumed = false;
      const target: StockItem = currentStock ?? ensureCurrentStock(fallbackStockName);
      currentStock = target;
      const seen = seenUrlsPerStock.get(target.id) ?? new Set<string>();

      for (const parsedNews of parsedNewsList) {
        if (!pendingConsumed && pendingTextLines.length > 0) {
          pendingRaw = pendingTextLines.join(' ').trim();
          const cleanedPending = stripDecorativeDividers(
            pendingRaw
              .replace(/(20\d{2})\s*[.\-/년]\s*(0?[1-9]|1[0-2])\s*[.\-/월]\s*(0?[1-9]|[12]\d|3[01])(?:\s*일)?\.?/g, '')
              .replace(/^[|\-–—·:\s]+|[|\-–—·:\s]+$/g, ''),
          );

          if (isMissingOrGenericTitle(parsedNews.title, parsedNews.url) && cleanedPending) {
            parsedNews.title = cleanedPending;
            parsedNews.category = inferCategory(cleanedPending, parsedNews.url);
          } else if (cleanedPending && cleanedPending !== parsedNews.title) {
            parsedNews.memo = parsedNews.memo
              ? `${cleanedPending} · ${parsedNews.memo}`
              : cleanedPending;
          }
          pendingTextLines = [];
          pendingConsumed = true;
        }

        if (isMissingOrGenericTitle(parsedNews.title, parsedNews.url) && parsedNews.memo.trim()) {
          parsedNews.title = parsedNews.memo.trim();
          parsedNews.memo = '';
          parsedNews.category = inferCategory(parsedNews.title, parsedNews.url);
        }

        const contentDate = extractDateFromContent(
          `${pendingRaw} ${parsedNews.title} ${parsedNews.memo}`,
          parsedNews.url,
          contextDate || undefined,
        );
        if (contentDate && (!parsedNews.date || parsedNews.date === contextDate || parsedNews.date === getTodayDate())) {
          parsedNews.date = contentDate;
        }

        if (!parsedNews.normalizedUrl || !seen.has(parsedNews.normalizedUrl)) {
          if (parsedNews.normalizedUrl) seen.add(parsedNews.normalizedUrl);
          seenUrlsPerStock.set(target.id, seen);
          target.news.push({
            ...parsedNews,
            id: createId('news'),
            addedAt: new Date().toISOString(),
          });
        }
      }
      continue;
    }

    // Metadata lines like "- 종목코드: 005930" or "- 섹터: 반도체"
    if (currentStock) {
      const tickerMeta = line.match(/^(?:[-*]\s*)?(?:종목코드|티커|ticker)\s*[:：]\s*([A-Za-z0-9.]+)/i);
      if (tickerMeta && !currentStock.ticker) {
        currentStock.ticker = tickerMeta[1].toUpperCase();
        pendingTextLines = [];
        continue;
      }
      const sectorMeta = line.match(/^(?:[-*]\s*)?(?:섹터|업종|sector)\s*[:：]\s*(.+)$/i);
      if (sectorMeta && !currentStock.sector) {
        currentStock.sector = stripDecorativeDividers(sectorMeta[1]);
        pendingTextLines = [];
        continue;
      }
      const renameMeta = line.match(/^\(\s*상장사명\s*변경\s*[:：].+\)$/);
      if (renameMeta) {
        if (!currentStock.summaryNote.includes(line)) {
          currentStock.summaryNote = currentStock.summaryNote
            ? `${line}\n${currentStock.summaryNote}`
            : line;
        }
        pendingTextLines = [];
        continue;
      }
    }

    // Skip empty placeholder line "(등록된 뉴스가 없습니다)"
    if (/^\(?\s*등록된 뉴스가 없습니다\s*\)?$/.test(line.replace(/^\s*[-*+]\s*/, ''))) {
      continue;
    }

    // Buffer plain-text title/headline waiting for the link on the next line
    const cleanedPlain = stripDecorativeDividers(
      line.replace(/^\s*(?:[-*+•▪▶◆■●○★☆※📌📰]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, ''),
    );
    if (cleanedPlain) {
      pendingTextLines.push(cleanedPlain);
    }
  }

  for (const s of stocks) {
    if (s.news.length > 1 && s.news.every((n) => Boolean(n.date))) {
      s.news.sort((a, b) => compareNewsDates(a.date, b.date, 'asc'));
    }
  }

  return consolidateUnclassifiedStocks(stocks);
}

const BIG4_CANONICAL_NAMES = new Set(['삼성전자', 'SK하이닉스', '현대차', '기아']);
const KOREAN_JOSA_REGEX = /^(?:은|는|이|가|을|를|의|와|과|도|만|에|로|나|다|라|께|요|랑|그룹)/;
const LEFT_WORD_CHAR_REGEX = /[가-힣A-Za-z0-9]/;
const RIGHT_KOR_CHAR_REGEX = /[가-힣]/;
const RIGHT_ALNUM_CHAR_REGEX = /[A-Za-z0-9]/;

const RENAMED_STOCK_ALIASES: Array<[string, string[]]> = [
  ['골프존홀딩스', ['골프존뉴딘홀딩스']],
  ['나라스페이스', ['나라스페이스테크놀로지']],
  ['동양철관', ['KBI동양철관']],
  ['SK이노', ['SK이노베이션']],
  ['콜마', ['한국콜마', '한국콜마홀딩스']],
];

function stripBylineAndBrokerPrefix(text: string): string {
  return text
    // Strip leading brokerage publisher e.g. OO證 / OO증권 "..." or OO證 ...
    .replace(/^\s*(?:\[[^\]]+\]\s*)*[가-힣A-Za-z0-9]+(?:증권|證)\s*[,:]?\s*(?=["'“‘\[])/u, '')
    .replace(/^\s*(?:\[[^\]]+\]\s*)*[가-힣A-Za-z0-9]+證\s*[,:]?\s+/u, '')
    // Strip trailing brokerage byline e.g. "... -하나증권" / "... -하나證"
    .replace(/\s*[-–—]\s*[가-힣A-Za-z0-9]+(?:증권|證)\s*$/u, '')
    // Ignore false-positive CBI (배터리 혁신 컨소시엄)
    .replace(/\bCBI\b/g, ' ')
    .trim();
}

function hasValidStockBoundary(text: string, start: number, end: number, term: string): boolean {
  if (start > 0 && LEFT_WORD_CHAR_REGEX.test(text[start - 1])) {
    return false;
  }
  if (end < text.length) {
    const rest = text.slice(end);
    const nextChar = rest[0];
    if (RIGHT_KOR_CHAR_REGEX.test(nextChar)) {
      if (!KOREAN_JOSA_REGEX.test(rest)) {
        return false;
      }
    } else if (/^[A-Za-z0-9]+$/.test(term) && RIGHT_ALNUM_CHAR_REGEX.test(nextChar)) {
      return false;
    }
  }
  return true;
}

export interface StockMatchAnalysis {
  matched: StockItem[];
  exclusionReason?: string;
}

export function analyzeStockMatchesInText(text: string, stocks: StockItem[]): StockMatchAnalysis {
  const cleanedText = stripBylineAndBrokerPrefix(text);
  if (!cleanedText) {
    return { matched: [], exclusionReason: '종목 미특정 (업종·테마 전반 또는 미등록 종목)' };
  }

  const eligibleStocks = stocks.filter((s) => !isUnclassifiedStock(s));
  if (eligibleStocks.length === 0) {
    return { matched: [], exclusionReason: '등록된 상장사 목록 없음' };
  }

  const stockByLowerName = new Map<string, StockItem>();
  for (const s of eligibleStocks) {
    stockByLowerName.set(s.name.toLowerCase(), s);
  }

  interface MatchCandidateTerm {
    term: string;
    stock: StockItem;
    isShortBig4Alias?: boolean;
  }

  const terms: MatchCandidateTerm[] = [];
  for (const s of eligibleStocks) {
    if (s.name) terms.push({ term: s.name, stock: s });
    if (s.ticker && s.ticker.length >= 3) {
      terms.push({ term: s.ticker, stock: s });
    }
    for (const a of s.aliases) {
      const t = a.trim();
      if (t.length >= 2) terms.push({ term: t, stock: s });
    }
  }

  // Big4 short abbreviations (삼성 -> 삼성전자, SK -> SK하이닉스)
  const samsung = stockByLowerName.get('삼성전자');
  if (samsung) terms.push({ term: '삼성', stock: samsung, isShortBig4Alias: true });
  const skhynix = stockByLowerName.get('sk하이닉스');
  if (skhynix) terms.push({ term: 'SK', stock: skhynix, isShortBig4Alias: true });

  // Renamed company aliases
  for (const [oldName, newNames] of RENAMED_STOCK_ALIASES) {
    for (const targetName of newNames) {
      const targetStock = stockByLowerName.get(targetName.toLowerCase());
      if (targetStock) {
        terms.push({ term: oldName, stock: targetStock });
      }
    }
  }

  // Longest term first to prevent shorter names stealing longer spans
  terms.sort((a, b) => b.term.length - a.term.length);

  const lowerText = cleanedText.toLowerCase();
  const occupiedSpans: Array<[number, number]> = [];
  const matchedMap = new Map<string, StockItem>();

  const overlapsOccupied = (s: number, e: number): boolean =>
    occupiedSpans.some(([os, oe]) => s < oe && e > os);

  for (const entry of terms) {
    const termLower = entry.term.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < lowerText.length) {
      const idx = lowerText.indexOf(termLower, searchFrom);
      if (idx === -1) break;
      const end = idx + entry.term.length;
      searchFrom = idx + 1;

      if (overlapsOccupied(idx, end)) continue;
      if (!hasValidStockBoundary(cleanedText, idx, end, entry.term)) continue;

      occupiedSpans.push([idx, end]);
      matchedMap.set(entry.stock.id, entry.stock);
    }
  }

  const allMatched = Array.from(matchedMap.values());
  if (allMatched.length === 0) {
    return { matched: [], exclusionReason: '종목 미특정 (업종·테마 전반 또는 미등록 종목)' };
  }

  const nonBig4 = allMatched.filter((s) => !BIG4_CANONICAL_NAMES.has(s.name));
  if (nonBig4.length > 0) {
    // Big4 rule: if any non-Big4 stock is mentioned alongside Big4, place only under non-Big4
    return { matched: nonBig4 };
  }

  // Only Big4 matched
  const matchedBig4Names = new Set(allMatched.map((s) => s.name));
  if (
    matchedBig4Names.has('삼성전자') &&
    matchedBig4Names.has('현대차') &&
    matchedBig4Names.has('SK하이닉스')
  ) {
    return {
      matched: [],
      exclusionReason: 'Big4 규칙 제외 (삼성전자·현대차·SK하이닉스 동시 언급)',
    };
  }

  return { matched: allMatched };
}

export function matchStocksInText(text: string, stocks: StockItem[]): StockItem[] {
  return analyzeStockMatchesInText(text, stocks).matched;
}

export function matchStockInText(text: string, stocks: StockItem[]): StockItem | undefined {
  return matchStocksInText(text, stocks)[0];
}

export function parseIncomingNewsText(
  rawText: string,
  existingStocks: StockItem[],
  defaultStockId = '',
): ParsedMergeCandidate[] {
  const lines = rawText.split(/\r?\n/);
  const candidates: ParsedMergeCandidate[] = [];
  let activeHeadingStockIds: string[] = defaultStockId ? [defaultStockId] : [];
  let activeHeadingNewName = '';
  let activeHeadingNewTicker = '';
  let activeDate = '';
  let inFrontmatter = false;

  let pendingTextLines: string[] = [];

  const findRenamedTargets = (rawName: string): StockItem[] => {
    const targetKey = normalizeStockNameKey(rawName);
    const aliasEntry = RENAMED_STOCK_ALIASES.find(
      ([oldName]) => normalizeStockNameKey(oldName) === targetKey,
    );
    if (!aliasEntry) return [];
    const results: StockItem[] = [];
    for (const newName of aliasEntry[1]) {
      const found = existingStocks.find(
        (s) => !isUnclassifiedStock(s) && normalizeStockNameKey(s.name) === normalizeStockNameKey(newName),
      );
      if (found) results.push(found);
    }
    return results;
  };

  const findKnownStocksExact = (raw: string): StockItem[] => {
    const cleaned = raw
      .replace(/^\s*(?:[-*+•▪▶◆■●○★☆※]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, '')
      .replace(/^[\[(]/, '')
      .replace(/[\])]$/, '')
      .trim();
    if (!cleaned) return [];
    const parsed = parseStockHeading(cleaned);
    const krxTicker = /^\d{6}$/.test(parsed.ticker) ? parsed.ticker : '';
    const cleanedKey = normalizeStockNameKey(cleaned);
    const parsedKey = normalizeStockNameKey(parsed.name);
    const direct = existingStocks.find(
      (s) =>
        !isUnclassifiedStock(s) &&
        ((krxTicker && s.ticker && s.ticker.toUpperCase() === krxTicker) ||
          normalizeStockNameKey(s.name) === cleanedKey ||
          normalizeStockNameKey(s.name) === parsedKey ||
          s.aliases.some((a) => normalizeStockNameKey(a) === parsedKey)),
    );
    if (direct) return [direct];
    return findRenamedTargets(parsed.name);
  };

  const isKnownStockExact = (raw: string): StockItem | undefined => findKnownStocksExact(raw)[0];

  const looksLikePlainStockHeading = (raw: string, nextNonEmpty: string): boolean => {
    if (isHtmlOrNoiseLine(raw) || isInvalidStockHeading(raw)) return false;
    if (isKnownStockExact(raw)) return true;
    const cleaned = raw
      .replace(/^\s*(?:[-*+•▪▶◆■●○★☆※]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, '')
      .trim();
    if (!cleaned || /https?:\/\//i.test(cleaned)) return false;
    if (isStandaloneDateLine(cleaned)) return false;
    // If next non-empty line is a bare URL or generic link markdown, this line is the news title
    if (/^https?:\/\/\S+$/i.test(nextNonEmpty)) return false;
    if (/^[-*+•]?\s*\[(?:링크|기사|기사링크|원문|원문보기|뉴스|url|link|https?:\/\/[^\]]+)\]\(https?:\/\//i.test(nextNonEmpty)) {
      return false;
    }
    if (/^.{1,28}\s*[\[(](?:\d{6}|[A-Z]{1,5})[\])]$/.test(cleaned)) return true;
    if (cleaned.length > 18) return false;
    if (/^\[/.test(cleaned) || /[,."“”‘’!?…·%]$/.test(cleaned)) return false;
    if (
      /(?:발표|체결|수주|공시|상승|하락|전망|확대|돌파|기대|공개|출시|개발|성공|우려|급등|급락|매출|영업이익|흑자|적자|계약|공급|증설|투자|특허|임상|승인|배당|소각|선정|협력|협약|인수|합병|상장|리포트|목표가|실적|컨센서스|호재|악재|속보|단독|특징주)/.test(
        cleaned,
      )
    ) {
      return false;
    }
    return cleaned.split(/\s+/).length <= 2;
  };

  const looksLikeYamlStart = (idx: number): boolean => {
    for (let j = idx + 1; j < Math.min(idx + 4, lines.length); j++) {
      const next = lines[j].trim();
      if (!next) continue;
      return /^(?:date|created|updated|categories|tags|title)\s*:/i.test(next);
    }
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/<\/?br\s*\/?>/gi, ' ').trim();

    if (inFrontmatter) {
      if (/^---+$/.test(line)) {
        inFrontmatter = false;
        continue;
      }
      if (
        !line ||
        (/^(?:date|created|updated|categories|tags|title)\s*:/i.test(line) && !/https?:\/\//i.test(line)) ||
        (/^-\s+[^\[\]]+$/.test(line) && !/https?:\/\//i.test(line))
      ) {
        continue;
      }
      inFrontmatter = false;
    }

    if (/^---+$/.test(line) && looksLikeYamlStart(i)) {
      inFrontmatter = true;
      pendingTextLines = [];
      continue;
    }

    if (!line || isHtmlOrNoiseLine(line)) {
      pendingTextLines = [];
      continue;
    }

    // Heading section in pasted markdown
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      pendingTextLines = [];
      const content = stripDecorativeDividers(headingMatch[2]);
      if (!content) continue;
      if (isStandaloneDateLine(content)) {
        activeDate = normalizeDateString(content);
        continue;
      }
      if (isInvalidStockHeading(content)) {
        activeDate = '';
        activeHeadingStockIds = defaultStockId ? [defaultStockId] : [];
        activeHeadingNewName = '';
        activeHeadingNewTicker = '';
        continue;
      }
      activeDate = '';
      const parsedHeading = parseStockHeading(content);
      const exactMatches = findKnownStocksExact(content);
      const matchedList =
        exactMatches.length > 0
          ? exactMatches
          : matchStocksInText(content, existingStocks);
      if (matchedList.length > 0) {
        activeHeadingStockIds = matchedList.map((m) => m.id);
        activeHeadingNewName = '';
        activeHeadingNewTicker = '';
      } else {
        activeHeadingStockIds = [];
        activeHeadingNewName = parsedHeading.name;
        activeHeadingNewTicker = parsedHeading.ticker;
      }
      continue;
    }

    const parsed: Omit<NewsEntry, 'id' | 'addedAt'> | null = parseNewsLine(line, activeDate);

    if (!parsed) {
      // Date-only line (YYYY.MM.DD, YY.MM.DD, M월 D일, M/D, etc.)
      if (isStandaloneDateLine(line)) {
        activeDate = normalizeDateString(line);
        continue;
      }

      // Find next non-empty line for lookahead
      let nextNonEmpty = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextNonEmpty = lines[j].trim();
          break;
        }
      }

      if (pendingTextLines.length === 0 && looksLikePlainStockHeading(line, nextNonEmpty)) {
        activeDate = '';
        const cleanedHeading = stripDecorativeDividers(
          line.replace(/^\s*(?:[-*+•▪▶◆■●○★☆※📌📰]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, ''),
        );
        if (!cleanedHeading) continue;
        const matchedList = findKnownStocksExact(cleanedHeading);
        if (matchedList.length > 0) {
          activeHeadingStockIds = matchedList.map((m) => m.id);
          activeHeadingNewName = '';
          activeHeadingNewTicker = '';
        } else {
          const parsedHeading = parseStockHeading(cleanedHeading);
          activeHeadingStockIds = [];
          activeHeadingNewName = parsedHeading.name;
          activeHeadingNewTicker = parsedHeading.ticker;
        }
        continue;
      }

      // Otherwise buffer plain-text news content waiting for the hyperlink line below
      const cleanedNewsLine = stripDecorativeDividers(
        line.replace(/^\s*(?:[-*+•▪▶◆■●○★☆※📌📰]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, ''),
      );
      if (cleanedNewsLine) {
        pendingTextLines.push(cleanedNewsLine);
      }
      continue;
    }

    // Consume any buffered plain-text news content above this link
    let pendingRaw = '';
    if (pendingTextLines.length > 0) {
      pendingRaw = pendingTextLines.join(' ').trim();
      const cleanedPending = stripDecorativeDividers(
        pendingRaw
          .replace(/(20\d{2})\s*[.\-/년]\s*(0?[1-9]|1[0-2])\s*[.\-/월]\s*(0?[1-9]|[12]\d|3[01])(?:\s*일)?\.?/g, '')
          .replace(/^[|\-–—·:\s]+|[|\-–—·:\s]+$/g, ''),
      );

      if (isMissingOrGenericTitle(parsed.title, parsed.url) && cleanedPending) {
        parsed.title = cleanedPending;
        parsed.category = inferCategory(cleanedPending, parsed.url);
      } else if (cleanedPending && cleanedPending !== parsed.title) {
        parsed.memo = parsed.memo ? `${cleanedPending} · ${parsed.memo}` : cleanedPending;
      }
      pendingTextLines = [];
    }

    if (isMissingOrGenericTitle(parsed.title, parsed.url) && parsed.memo.trim()) {
      parsed.title = parsed.memo.trim();
      parsed.memo = '';
      parsed.category = inferCategory(parsed.title, parsed.url);
    }

    // Re-check date across pending text + title + memo + url so content-embedded dates are always honored
    const contentDate = extractDateFromContent(
      `${pendingRaw} ${parsed.title} ${parsed.memo}`,
      parsed.url,
      activeDate || undefined,
    );
    if (contentDate && (!parsed.date || parsed.date === activeDate || parsed.date === getTodayDate())) {
      parsed.date = contentDate;
    }

    // Match stock by explicit document heading first, otherwise match from title/memo (including multi-stock rules)
    const hasExplicitHeading = activeHeadingStockIds.length > 0 || Boolean(activeHeadingNewName);
    const analysis = hasExplicitHeading
      ? { matched: [] as StockItem[] }
      : analyzeStockMatchesInText(`${parsed.title} ${parsed.memo}`, existingStocks);

    const targets: Array<{
      matchedStockId: string;
      suggestedName: string;
      suggestedTicker: string;
      exclusionReason?: string;
    }> = hasExplicitHeading
      ? activeHeadingStockIds.length > 0
        ? activeHeadingStockIds.map((id) => ({
            matchedStockId: id,
            suggestedName: '',
            suggestedTicker: '',
          }))
        : [
            {
              matchedStockId: '',
              suggestedName: activeHeadingNewName,
              suggestedTicker: activeHeadingNewTicker,
            },
          ]
      : analysis.matched.length > 0
        ? analysis.matched.map((m) => ({
            matchedStockId: m.id,
            suggestedName: '',
            suggestedTicker: '',
          }))
        : [
            {
              matchedStockId: '',
              suggestedName: '',
              suggestedTicker: '',
              exclusionReason: analysis.exclusionReason,
            },
          ];

    const needsTitleFetch = isMissingOrGenericTitle(parsed.title, parsed.url);

    for (const targetInfo of targets) {
      const targetStock = existingStocks.find((s) => s.id === targetInfo.matchedStockId);
      const batchItemsSoFar = candidates.map((c) => ({
        normalizedUrl: c.normalizedUrl,
        title: c.title,
        stockId: c.matchedStockId,
        newStockName: c.suggestedNewStockName,
      }));

      const dup = checkDuplicateStatus(
        parsed.title,
        parsed.normalizedUrl,
        targetStock,
        batchItemsSoFar,
        targetInfo.suggestedName,
      );

      candidates.push({
        tempId: createId('cand'),
        title: parsed.title,
        url: parsed.url,
        normalizedUrl: parsed.normalizedUrl,
        date: parsed.date,
        source: parsed.source,
        category: parsed.category,
        memo: parsed.memo,
        matchedStockId: targetInfo.matchedStockId,
        suggestedNewStockName: targetInfo.suggestedName,
        suggestedNewTicker: targetInfo.suggestedTicker,
        duplicateStatus: dup.status,
        duplicateReason: dup.reason,
        exclusionReason: targetInfo.exclusionReason,
        selected: dup.status === 'new',
        needsTitleFetch,
      });
    }
  }

  return candidates;
}

function formatNewsLine(entry: NewsEntry, config: MarkdownFormatConfig): string {
  const link = `[${entry.title}](${entry.url})`;
  const metaParts: string[] = [];
  if (config.includeCategory && entry.category !== '일반') {
    metaParts.push(entry.category);
  }
  if (config.includeSource && entry.source) {
    metaParts.push(entry.source);
  }
  const metaSuffix = metaParts.length > 0 ? ` · ${metaParts.join(' / ')}` : '';
  const memoSuffix = config.includeMemo && entry.memo.trim() ? ` — ${entry.memo.trim()}` : '';

  if (config.linkStyle === 'pipe-date') {
    return entry.date
      ? `- ${entry.date} | ${link}${metaSuffix}${memoSuffix}`
      : `- ${link}${metaSuffix}${memoSuffix}`;
  }
  if (config.linkStyle === 'trailing-date') {
    return entry.date
      ? `- ${link} (${entry.date})${metaSuffix}${memoSuffix}`
      : `- ${link}${metaSuffix}${memoSuffix}`;
  }
  // date-grouped
  return `- ${link}${metaSuffix}${memoSuffix}`;
}

function makeStockHashtag(stockName: string): string {
  const cleaned = stockName.replace(/[^\p{L}\p{N}_]/gu, '');
  return cleaned ? `#${cleaned}` : '';
}

function makeMarkdownAnchor(headingText: string): string {
  return headingText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function compileStockToMarkdown(stock: StockItem, config: MarkdownFormatConfig): string {
  const prefix = '#'.repeat(config.headingLevel);
  const tickerPart = stock.ticker ? ` (${stock.ticker})` : '';
  const hashtagPart = config.includeHashtag ? makeStockHashtag(stock.name) : '';
  const metaParts = [
    stock.market !== '미분류' ? stock.market : '',
    stock.sector,
    hashtagPart,
  ].filter(Boolean);
  const headingMeta = metaParts.length > 0 ? ` | ${metaParts.join(' · ')}` : '';

  const lines: string[] = [`${prefix} ${stock.name}${tickerPart}${headingMeta}`];

  if (stock.summaryNote.trim()) {
    const noteLines = stock.summaryNote
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (noteLines.length > 0) {
      lines.push('');
      for (const nl of noteLines) {
        lines.push(`> ${nl}`);
      }
    }
  }

  const sortedNews = [...stock.news].sort((a, b) =>
    compareNewsDates(a.date, b.date, config.sortOrder),
  );

  if (sortedNews.length === 0) {
    lines.push('');
    lines.push('- (등록된 뉴스가 없습니다)');
    return lines.join('\n');
  }

  lines.push('');

  if (config.linkStyle === 'date-grouped') {
    const subPrefix = '#'.repeat(Math.min(config.headingLevel + 1, 4));
    let lastDate = '__UNSET__';
    for (const item of sortedNews) {
      const groupLabel = item.date || '날짜 미상';
      if (groupLabel !== lastDate) {
        if (lastDate !== '__UNSET__') lines.push('');
        lines.push(`${subPrefix} ${groupLabel}`);
        lastDate = groupLabel;
      }
      lines.push(formatNewsLine(item, config));
    }
  } else {
    for (const item of sortedNews) {
      lines.push(formatNewsLine(item, config));
    }
  }

  return lines.join('\n');
}

export function compileStockToBotArchive(
  stock: StockItem,
  config: MarkdownFormatConfig,
): string {
  const sortedNews = [...stock.news].sort((a, b) =>
    compareNewsDates(a.date, b.date, config.sortOrder),
  );
  if (sortedNews.length === 0) return '';

  const sectionDate =
    (stock.updatedAt && /^\d{4}-\d{2}-\d{2}/.test(stock.updatedAt)
      ? stock.updatedAt.slice(0, 10)
      : getTodayDate()) + ' 00:00:00';

  const articleBlocks = sortedNews.map((item) => {
    const titleText =
      config.includeDateInBotTitle && item.date && !item.title.includes(item.date)
        ? `[${item.date}] ${item.title}`
        : item.title;
    return `[${titleText}](${item.url})  `;
  });

  const renameLines = stock.summaryNote
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\(?\s*상장사명\s*변경\s*[:：]/.test(l));

  const lines: string[] = [
    `## ===== ${stock.name} =====`,
    '---',
    `date: ${sectionDate}`,
    `created: ${sectionDate}`,
    'categories:',
    '- 종목 / 종목',
    '---',
    '',
    `## ${stock.name}`,
    '',
    ...(renameLines.length > 0 ? [...renameLines, ''] : []),
    articleBlocks.join('\n\n<br>\n\n'),
    '',
    '---',
  ];

  return lines.join('\n');
}

export function compileWorkspaceToMarkdown(stocks: StockItem[], config: MarkdownFormatConfig): string {
  const preset = config.exportPreset ?? 'bot-archive';
  if (preset === 'bot-archive') {
    const exportable = stocks.filter((s) => !isUnclassifiedStock(s) && s.news.length > 0);
    if (exportable.length === 0) return '';
    return `${exportable.map((s) => compileStockToBotArchive(s, config)).join('\n\n')}\n`;
  }

  const exportable = stocks.filter((s) => s.news.length > 0);
  const totalNews = exportable.reduce((sum, s) => sum + s.news.length, 0);
  const parts: string[] = [
    `# 상장사 종목별 뉴스 정리\n\n> 최근 업데이트: ${getTodayDate()} · 총 ${exportable.length}개 종목 · 뉴스 ${totalNews}건`,
  ];

  if (config.includeToc && exportable.length > 0) {
    const tocPrefix = '#'.repeat(Math.min(config.headingLevel + 1, 3));
    const tocLines = exportable.map((s) => {
      const tickerPart = s.ticker ? ` (${s.ticker})` : '';
      const hashtagPart = config.includeHashtag ? makeStockHashtag(s.name) : '';
      const fullHeading = `${s.name}${tickerPart}${
        [s.market !== '미분류' ? s.market : '', s.sector, hashtagPart].filter(Boolean).length > 0
          ? ` | ${[s.market !== '미분류' ? s.market : '', s.sector, hashtagPart].filter(Boolean).join(' · ')}`
          : ''
      }`;
      const anchor = makeMarkdownAnchor(fullHeading);
      return `- [${s.name}${tickerPart}](#${anchor}) · ${s.news.length}건`;
    });
    parts.push(`${tocPrefix} 종목 목차\n\n${tocLines.join('\n')}`);
  }

  if (exportable.length > 0) {
    const body = exportable.map((s) => compileStockToMarkdown(s, config)).join('\n\n---\n\n');
    parts.push(body);
  }

  return `${parts.join('\n\n')}\n`;
}

export interface TelegramChunk {
  index: number;
  text: string;
  stockNames: string[];
}

export function compileStockForTelegram(stock: StockItem, config: MarkdownFormatConfig): string {
  const tickerPart = stock.ticker ? ` (${stock.ticker})` : '';
  const hashtag = makeStockHashtag(stock.name);
  const metaParts = [stock.market !== '미분류' ? stock.market : '', stock.sector].filter(Boolean);
  const metaSuffix = metaParts.length > 0 ? ` · ${metaParts.join(' · ')}` : '';
  const header = `▶ ${stock.name}${tickerPart}${metaSuffix} ${hashtag}`.trim();

  const lines: string[] = [header];
  if (stock.summaryNote.trim()) {
    lines.push(`메모: ${stock.summaryNote.trim().replace(/\s*\n+\s*/g, ' / ')}`);
  }

  const sortedNews = [...stock.news].sort((a, b) =>
    compareNewsDates(a.date, b.date, config.sortOrder),
  );

  for (const item of sortedNews) {
    const catPart = config.includeCategory && item.category !== '일반' ? `[${item.category}] ` : '';
    const srcPart = config.includeSource && item.source ? ` (${item.source})` : '';
    const memoPart = config.includeMemo && item.memo.trim() ? `\n  메모: ${item.memo.trim()}` : '';
    const datePart = item.date ? `${item.date} | ` : '';
    lines.push(`• ${datePart}${catPart}${item.title}${srcPart}\n  ${item.url}${memoPart}`);
  }

  return lines.join('\n');
}

export function compileWorkspaceToTelegramChunks(
  stocks: StockItem[],
  config: MarkdownFormatConfig,
  maxChars = 3800,
): TelegramChunk[] {
  const exportable = stocks.filter((s) => s.news.length > 0);
  if (exportable.length === 0) return [];

  const chunks: TelegramChunk[] = [];
  let currentParts: string[] = [];
  let currentStockNames: string[] = [];
  let currentLen = 0;

  const pushChunk = () => {
    if (currentParts.length === 0) return;
    chunks.push({
      index: chunks.length + 1,
      text: currentParts.join('\n\n'),
      stockNames: [...currentStockNames],
    });
    currentParts = [];
    currentStockNames = [];
    currentLen = 0;
  };

  for (const stock of exportable) {
    const block = compileStockForTelegram(stock, config);
    if (block.length <= maxChars) {
      const separatorLen = currentParts.length > 0 ? 2 : 0;
      if (currentLen + separatorLen + block.length > maxChars) {
        pushChunk();
      }
      currentParts.push(block);
      currentStockNames.push(stock.name);
      currentLen += (currentParts.length > 1 ? 2 : 0) + block.length;
    } else {
      // Split very large stock across multiple Telegram-safe chunks while keeping hashtag on every part
      pushChunk();
      const lines = block.split('\n');
      const header = lines[0];
      let subLines: string[] = [header];
      let subLen = header.length;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (subLen + 1 + line.length > maxChars && subLines.length > 1) {
          chunks.push({
            index: chunks.length + 1,
            text: subLines.join('\n'),
            stockNames: [stock.name],
          });
          const contHeader = `${header} (계속)`;
          subLines = [contHeader, line];
          subLen = contHeader.length + 1 + line.length;
        } else {
          subLines.push(line);
          subLen += 1 + line.length;
        }
      }
      if (subLines.length > 0) {
        chunks.push({
          index: chunks.length + 1,
          text: subLines.join('\n'),
          stockNames: [stock.name],
        });
      }
    }
  }

  pushChunk();
  return chunks;
}
