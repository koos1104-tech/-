export type MarketType = 'KOSPI' | 'KOSDAQ' | '해외' | '미분류';

export type NewsCategory =
  | '실적/가이던스'
  | '공시/지분'
  | '수주/계약'
  | '신사업/R&D'
  | '주주환원'
  | '업황/리포트'
  | '일반';

export interface NewsEntry {
  id: string;
  title: string;
  url: string;
  normalizedUrl: string;
  date: string; // YYYY-MM-DD
  source: string;
  category: NewsCategory;
  memo: string;
  addedAt: string;
}

export interface StockItem {
  id: string;
  name: string;
  ticker: string;
  market: MarketType;
  sector: string;
  aliases: string[];
  summaryNote: string;
  news: NewsEntry[];
  updatedAt: string;
}

export type MarkdownLinkStyle = 'pipe-date' | 'trailing-date' | 'date-grouped';
export type MarkdownHeadingLevel = 1 | 2;
export type SortOrder = 'desc' | 'asc';
export type MarkdownExportPreset = 'bot-archive' | 'standard';

export interface MarkdownFormatConfig {
  exportPreset?: MarkdownExportPreset;
  includeDateInBotTitle?: boolean;
  headingLevel: MarkdownHeadingLevel;
  linkStyle: MarkdownLinkStyle;
  includeSource: boolean;
  includeCategory: boolean;
  includeMemo: boolean;
  includeToc: boolean;
  includeHashtag: boolean;
  sortOrder: SortOrder;
}

export type DuplicateStatus = 'new' | 'duplicate-url' | 'similar-title';

export interface ParsedMergeCandidate {
  tempId: string;
  title: string;
  url: string;
  normalizedUrl: string;
  date: string;
  source: string;
  category: NewsCategory;
  memo: string;
  matchedStockId: string; // '' if unassigned / create new
  suggestedNewStockName: string;
  suggestedNewTicker: string;
  duplicateStatus: DuplicateStatus;
  duplicateReason?: string;
  exclusionReason?: string;
  selected: boolean;
  needsTitleFetch: boolean;
}

export type NewsSearchPeriod = '30d' | '1y' | '2y' | 'all';
export type NewsSearchRegion = 'ko' | 'en';

export interface LatestNewsSearchResult {
  title: string;
  url: string;
  date: string;
  source: string;
  publishedAt: string;
  providers?: Array<'google' | 'naver'>;
}

export interface QuickNewsSaveResult {
  status: 'saved' | 'duplicate';
  stockNames: string[];
  primaryStockId?: string;
  duplicateReason?: string;
}

