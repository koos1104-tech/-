import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const LOCAL_DATA_DIR = path.resolve(__dirname, 'local-data');

type LocalArchiveFilename = 'stocks-archive.json' | 'config.json' | '종목뉴스_전체.md';

function resolveLocalDataPath(fileName: LocalArchiveFilename): string {
  const resolved = path.resolve(LOCAL_DATA_DIR, fileName);
  if (!resolved.startsWith(LOCAL_DATA_DIR + path.sep)) {
    throw new Error('허용되지 않은 경로입니다.');
  }
  return resolved;
}

function isLocalOnlyRequest(req: express.Request): boolean {
  const host = (req.hostname || '').toLowerCase();
  const remote = req.socket.remoteAddress || '';
  const validHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const validRemote =
    remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return validHost && validRemote;
}

async function atomicWriteLocalFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    );
  }
  return true;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('지원되지 않는 프로토콜입니다.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('내부 호스트 접근이 차단되었습니다.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('사설 IP 접근이 차단되었습니다.');
    }
    return parsed;
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('안전하지 않은 네트워크 대상입니다.');
  }
  return parsed;
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&middot;': '·',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&ldquo;': '“',
    '&rdquo;': '”',
  };
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|middot|lsquo|rsquo|ldquo|rdquo|#39);/gi, (m) => {
      return named[m.toLowerCase()] ?? m;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateCandidate(raw: string): string | undefined {
  const clean = raw.trim();
  if (!clean) return undefined;

  // 1. YYYY-MM-DD / YYYY. MM. DD / YYYY년 MM월 DD일
  const sepMatch = clean.match(/(20\d{2})\s*[-./년]\s*(0?[1-9]|1[0-2])\s*[-./월]\s*(0?[1-9]|[12]\d|3[01])/);
  if (sepMatch) {
    return `${sepMatch[1]}-${sepMatch[2].padStart(2, '0')}-${sepMatch[3].padStart(2, '0')}`;
  }

  // 2. YYYYMMDD
  const compactMatch = clean.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  // 3. RFC 2822 / English date strings containing 20xx year + month word
  if (/20\d{2}/.test(clean) && /[a-z]{3}/i.test(clean)) {
    const parsed = new Date(clean);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear();
      if (y >= 2000 && y <= 2099) {
        const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        const d = String(parsed.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
  }

  return undefined;
}

function extractMetaFromHtml(html: string, pageUrl = ''): { title?: string; date?: string } {
  const ogTitleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const twitterTitleMatch =
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i);
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const rawTitle = ogTitleMatch?.[1] || twitterTitleMatch?.[1] || titleTagMatch?.[1];
  const title = rawTitle ? decodeHtmlEntities(rawTitle) : undefined;

  const dateCandidates: Array<string | undefined> = [];

  // 1. JSON-LD / Next.js / Escaped JSON fields
  const jsonDatePatterns = [
    /\\?"(?:datePublished|dateCreated|publishDate|pubDate|publishedAt|published_at|articleDate|writeDate|regDt|regDate|reg_dt|svcDate|service_daytime|uploadDate)\\?"\s*:\s*\\?"([^"\\]+)\\?"/gi,
  ];
  for (const re of jsonDatePatterns) {
    for (const m of html.matchAll(re)) {
      if (m[1]) dateCandidates.push(m[1]);
    }
  }

  // 2. Meta tags (OpenGraph, Article, Naver, Daum, Dable, Parsely, Dublin Core)
  const metaAttrNames =
    'article:published_time|og:article:published_time|article:published|pubdate|publishdate|publish_date|og:pubdate|date|datePublished|dable:pub_date|dd:published_time|og:regDate|regDate|nv:news:published_time|parsely-pub-date|DC\\.date\\.issued|sailthru\\.date|cXenseParse:recs:publishtime';
  const metaRegexA = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["'](?:${metaAttrNames})["'][^>]+content=["']([^"']+)["']`,
    'gi',
  );
  const metaRegexB = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:${metaAttrNames})["']`,
    'gi',
  );
  for (const m of html.matchAll(metaRegexA)) {
    if (m[1]) dateCandidates.push(m[1]);
  }
  for (const m of html.matchAll(metaRegexB)) {
    if (m[1]) dateCandidates.push(m[1]);
  }

  // 3. Naver news data-date-time, itemprop datetime, HTML <time datetime="...">
  for (const m of html.matchAll(/data-(?:date-time|published|pubdate|date)=["']([^"']+)["']/gi)) {
    if (m[1]) dateCandidates.push(m[1]);
  }
  for (const m of html.matchAll(/<time[^>]+datetime=["']([^"']+)["']/gi)) {
    if (m[1]) dateCandidates.push(m[1]);
  }
  for (const m of html.matchAll(/<time[^>]*>([\s\S]{4,40}?)<\/time>/gi)) {
    if (m[1]) dateCandidates.push(m[1].replace(/<[^>]+>/g, ' '));
  }

  // 4. Korean article timestamp labels & date/datestamp elements
  for (const m of html.matchAll(
    /(?:기사입력|입력|승인|작성일?|등록일?|송고|게재|발행)\s*[:：]?\s*(?:<[^>]+>\s*)*?(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/gi,
  )) {
    if (m[1]) dateCandidates.push(m[1]);
  }
  for (const m of html.matchAll(
    /class=["'][^"']*(?:datestamp|article_date|num_date|se_publishDate|byline|date_time|pub_date|news_date)[^"']*["'][^>]*>([\s\S]{4,80}?)</gi,
  )) {
    if (m[1]) dateCandidates.push(m[1]);
  }

  // 5. Fallback: URL path/params (check both final resolved URL and raw URL)
  if (pageUrl) dateCandidates.push(pageUrl);

  let date: string | undefined;
  for (const cand of dateCandidates) {
    if (!cand) continue;
    const parsed = parseDateCandidate(cand);
    if (parsed) {
      date = parsed;
      break;
    }
  }

  return { title, date };
}

async function fetchSingleMeta(rawUrl: string): Promise<{ title?: string; date?: string; error?: string }> {
  try {
    const safeUrl = await assertSafeUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(safeUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          Referer: 'https://www.google.com/',
        },
      });

      const resolvedUrl = response.url || rawUrl;

      if (!response.ok) {
        const fallbackDate = parseDateCandidate(resolvedUrl) || parseDateCandidate(rawUrl);
        return fallbackDate ? { date: fallbackDate } : { error: `HTTP ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        const fallbackDate = parseDateCandidate(resolvedUrl) || parseDateCandidate(rawUrl);
        return fallbackDate ? { date: fallbackDate } : { error: 'HTML 문서가 아닙니다.' };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return { error: '응답 본문을 읽을 수 없습니다.' };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const MAX_BYTES = 1024 * 1024;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalBytes += value.byteLength;
          if (totalBytes >= MAX_BYTES) {
            await reader.cancel();
            break;
          }
        }
      }

      const buffer = Buffer.concat(chunks);
      let html = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const declaredCharset =
        contentType.match(/charset=([^;\s]+)/i)?.[1] ||
        html.match(/<meta[^>]+charset=["']?([^"';\s>]+)/i)?.[1] ||
        '';
      if (/euc-kr|ks_c_5601|cp949/i.test(declaredCharset)) {
        try {
          html = new TextDecoder('euc-kr').decode(buffer);
        } catch {
          // keep utf-8
        }
      }
      const extracted = extractMetaFromHtml(html, resolvedUrl);
      if (!extracted.date) {
        extracted.date = parseDateCandidate(rawUrl);
      }
      if (!extracted.title && !extracted.date) {
        return { error: '제목과 날짜를 찾지 못했습니다.' };
      }
      return extracted;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const fallbackDate = parseDateCandidate(rawUrl);
    if (fallbackDate) return { date: fallbackDate };
    return {
      error: err instanceof Error ? err.message : '메타데이터 조회 실패',
    };
  }
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.post('/api/fetch-meta', async (req, res) => {
    const body = req.body as { urls?: unknown };
    if (!Array.isArray(body?.urls)) {
      res.status(400).json({ error: 'urls 배열이 필요합니다.' });
      return;
    }

    const uniqueUrls = Array.from(
      new Set(
        body.urls
          .filter((item): item is string => typeof item === 'string')
          .map((u) => u.trim())
          .filter((u) => u.startsWith('http://') || u.startsWith('https://')),
      ),
    ).slice(0, 50);

    const results: Record<string, { title?: string; date?: string; error?: string }> = {};
    const CONCURRENCY = 6;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, uniqueUrls.length) }, async () => {
      while (cursor < uniqueUrls.length) {
        const idx = cursor++;
        const url = uniqueUrls[idx];
        results[url] = await fetchSingleMeta(url);
      }
    });
    await Promise.all(workers);

    res.json({ results });
  });

  app.post('/api/search-news', async (req, res) => {
    const body = req.body as {
      query?: unknown;
      period?: unknown;
      region?: unknown;
      limit?: unknown;
    };

    const rawQuery = typeof body?.query === 'string' ? body.query.replace(/[\r\n\t]+/g, ' ').trim() : '';
    if (!rawQuery || rawQuery.length > 100) {
      res.status(400).json({ error: '검색할 종목명이나 키워드를 1~100자 이내로 입력하세요.' });
      return;
    }

    const period =
      body?.period === '30d' || body?.period === '1y' || body?.period === '2y' || body?.period === 'all'
        ? body.period
        : '30d';
    const region = body?.region === 'en' ? 'en' : 'ko';
    const rawLimit = typeof body?.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : 50;
    const limit = Math.min(Math.max(rawLimit, 1), 100);

    const BROWSER_UA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    const readBodyWithLimit = async (response: Response, maxBytes = 2 * 1024 * 1024): Promise<string> => {
      const reader = response.body?.getReader();
      if (!reader) return '';
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalBytes += value.byteLength;
          if (totalBytes >= maxBytes) {
            await reader.cancel();
            break;
          }
        }
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
    };

    const stripCdataAndTags = (value: string): string => {
      const unwrapped = value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1');
      return decodeHtmlEntities(unwrapped.replace(/<[^>]+>/g, ' '));
    };

    const toKstDateStr = (ms: number): string =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms));

    const formatKstDate = (pubDateStr: string): { date: string; timestamp: number; iso: string } => {
      const parsed = new Date(pubDateStr);
      if (Number.isNaN(parsed.getTime())) {
        return { date: '', timestamp: 0, iso: '' };
      }
      const ms = parsed.getTime();
      return { date: toKstDateStr(ms), timestamp: ms, iso: parsed.toISOString() };
    };

    const cleanTrackedUrl = (rawUrl: string): string => {
      try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        for (const key of Array.from(u.searchParams.keys())) {
          const lower = key.toLowerCase();
          if (
            lower.startsWith('utm_') ||
            lower === 'fbclid' ||
            lower === 'gclid' ||
            lower === 'oc'
          ) {
            u.searchParams.delete(key);
          }
        }
        return u.toString();
      } catch {
        return '';
      }
    };

    const canonicalUrlKey = (rawUrl: string): string => {
      try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
        const pathname = u.pathname.replace(/\/+$/, '') || '/';
        const keptParams = Array.from(u.searchParams.entries())
          .filter(([k]) => {
            const lk = k.toLowerCase();
            return (
              !lk.startsWith('utm_') &&
              !['fbclid', 'gclid', 'oc', 'input', 'ref', 'sid', 'from', 'na'].includes(lk)
            );
          })
          .sort(([a], [b]) => a.localeCompare(b));
        const qs = keptParams.length > 0 ? `?${new URLSearchParams(keptParams).toString()}` : '';
        return `${host}${pathname}${qs}`;
      } catch {
        return rawUrl.trim().toLowerCase();
      }
    };

    const normalizeTitleKey = (title: string): string =>
      title
        .replace(/\[[^\]]{1,12}\]/g, ' ')
        .replace(/(\.\.\.|…)+$/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');

    const bigramSimilarity = (a: string, b: string): number => {
      if (!a || !b) return 0;
      if (a === b) return 1;
      if (a.length < 4 || b.length < 4) return 0;
      const toBigrams = (s: string) => {
        const map = new Map<string, number>();
        for (let i = 0; i < s.length - 1; i++) {
          const bg = s.slice(i, i + 2);
          map.set(bg, (map.get(bg) ?? 0) + 1);
        }
        return map;
      };
      const mapA = toBigrams(a);
      const mapB = toBigrams(b);
      let intersection = 0;
      for (const [bg, countA] of mapA) {
        const countB = mapB.get(bg) ?? 0;
        intersection += Math.min(countA, countB);
      }
      return (2 * intersection) / (a.length - 1 + (b.length - 1));
    };

    const resolveGoogleNewsUrl = async (rssUrl: string, signal: AbortSignal): Promise<string> => {
      const idMatch = rssUrl.match(/\/articles\/([^?/]+)/);
      if (!idMatch) return cleanTrackedUrl(rssUrl);
      const articleId = idMatch[1];

      // 1. Offline base64 protobuf decode for legacy tokens
      try {
        const buf = Buffer.from(articleId.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const latin = buf.toString('latin1');
        const idx = latin.indexOf('\x08\x13\x22');
        if (idx !== -1 && buf.length > idx + 4) {
          let len = buf[idx + 3];
          let start = idx + 4;
          if (len >= 0x80 && buf.length > idx + 5) {
            len = (len & 0x7f) + ((buf[idx + 4] & 0x7f) << 7);
            start = idx + 5;
          }
          const candidate = buf.subarray(start, start + len).toString('utf8');
          const cleaned = cleanTrackedUrl(candidate);
          if (cleaned && !cleaned.includes('news.google.com')) {
            return cleaned;
          }
        }
      } catch {
        // fallback to batchexecute
      }

      // 2. Decode encrypted CBMi... token via Google batchexecute
      try {
        const pageRes = await fetch(`https://news.google.com/rss/articles/${encodeURIComponent(articleId)}`, {
          method: 'GET',
          signal,
          headers: { 'User-Agent': BROWSER_UA },
        });
        if (!pageRes.ok) return cleanTrackedUrl(rssUrl);
        const html = await readBodyWithLimit(pageRes, 1536 * 1024);
        const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
        if (!sg || !ts) return cleanTrackedUrl(rssUrl);

        const reqPayload = [
          [
            [
              'Fbv4je',
              JSON.stringify([
                'garturlreq',
                [
                  ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
                  'X',
                  'X',
                  1,
                  [1, 1, 1],
                  1,
                  1,
                  null,
                  0,
                  0,
                  null,
                  0,
                ],
                articleId,
                Number(ts),
                sg,
              ]),
              null,
              'generic',
            ],
          ],
        ];
        const bRes = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': BROWSER_UA,
          },
          body: `f.req=${encodeURIComponent(JSON.stringify(reqPayload))}`,
        });
        if (!bRes.ok) return cleanTrackedUrl(rssUrl);
        const bText = await readBodyWithLimit(bRes, 256 * 1024);
        const line = bText.split('\n').find((l) => l.includes('garturlres'));
        if (line) {
          const outer = JSON.parse(line) as unknown[];
          const first = Array.isArray(outer[0]) ? outer[0] : [];
          if (typeof first[2] === 'string') {
            const inner = JSON.parse(first[2]) as unknown[];
            if (typeof inner[1] === 'string') {
              const resolved = cleanTrackedUrl(inner[1]);
              if (resolved) return resolved;
            }
          }
        }
      } catch {
        // fallback to original RSS link
      }
      return cleanTrackedUrl(rssUrl);
    };

    const parseNaverDateText = (text: string, nowMs: number): { date: string; timestamp: number; iso: string } => {
      const clean = text.trim();
      const minMatch = clean.match(/(\d+)\s*분\s*전/);
      if (minMatch) {
        const ms = nowMs - Number(minMatch[1]) * 60_000;
        return { date: toKstDateStr(ms), timestamp: ms, iso: new Date(ms).toISOString() };
      }
      const hourMatch = clean.match(/(\d+)\s*시간\s*전/);
      if (hourMatch) {
        const ms = nowMs - Number(hourMatch[1]) * 3_600_000;
        return { date: toKstDateStr(ms), timestamp: ms, iso: new Date(ms).toISOString() };
      }
      const dayMatch = clean.match(/(\d+)\s*일\s*전/);
      if (dayMatch) {
        const ms = nowMs - Number(dayMatch[1]) * 86_400_000;
        return { date: toKstDateStr(ms), timestamp: ms, iso: new Date(ms).toISOString() };
      }
      const weekMatch = clean.match(/(\d+)\s*주\s*전/);
      if (weekMatch) {
        const ms = nowMs - Number(weekMatch[1]) * 7 * 86_400_000;
        return { date: toKstDateStr(ms), timestamp: ms, iso: new Date(ms).toISOString() };
      }
      if (/방금|초\s*전/.test(clean)) {
        return { date: toKstDateStr(nowMs), timestamp: nowMs, iso: new Date(nowMs).toISOString() };
      }
      const absDate = parseDateCandidate(clean);
      if (absDate) {
        const ms = new Date(`${absDate}T12:00:00+09:00`).getTime();
        return { date: absDate, timestamp: ms, iso: new Date(ms).toISOString() };
      }
      return { date: '', timestamp: 0, iso: '' };
    };

    type SearchCandidate = {
      title: string;
      url: string;
      date: string;
      source: string;
      publishedAt: string;
      timestamp: number;
      providers: Array<'google' | 'naver'>;
    };

    const searchGoogleNews = async (signal: AbortSignal): Promise<SearchCandidate[]> => {
      const periodSuffix = period === 'all' ? '' : ` when:${period}`;
      const rssQuery = `${rawQuery}${periodSuffix}`;
      const localeParams =
        region === 'en' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=ko&gl=KR&ceid=KR:ko';
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rssQuery)}&${localeParams}`;

      const response = await fetch(rssUrl, {
        method: 'GET',
        signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
          'Accept-Language': region === 'en' ? 'en-US,en;q=0.9' : 'ko-KR,ko;q=0.9,en;q=0.7',
        },
      });
      if (!response.ok) return [];

      const xml = await readBodyWithLimit(response, 2 * 1024 * 1024);
      const rawItems: SearchCandidate[] = [];

      for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const itemXml = match[1];
        const rawTitle = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '';
        const rawLink = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? '';
        const rawPubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? '';
        const rawSource = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? '';

        const cleanSource = stripCdataAndTags(rawSource);
        let cleanTitle = stripCdataAndTags(rawTitle);
        if (cleanSource && cleanTitle.endsWith(` - ${cleanSource}`)) {
          cleanTitle = cleanTitle.slice(0, -(` - ${cleanSource}`).length).trim();
        }
        const cleanLink = cleanTrackedUrl(
          decodeHtmlEntities(rawLink.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1').trim()),
        );
        if (!cleanLink || !cleanTitle) continue;

        const { date, timestamp, iso } = formatKstDate(stripCdataAndTags(rawPubDate));
        rawItems.push({
          title: cleanTitle,
          url: cleanLink,
          date,
          source: cleanSource || 'Google 뉴스',
          publishedAt: iso,
          timestamp,
          providers: ['google'],
        });
      }

      rawItems.sort((a, b) => b.timestamp - a.timestamp);
      const maxGoogle = region === 'en' ? limit : Math.min(limit, 35);
      const selected = rawItems.slice(0, maxGoogle);

      // Resolve Google News wrapper links to direct publisher URLs concurrently
      const CONCURRENCY = 10;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, selected.length) }, async () => {
        while (cursor < selected.length) {
          const idx = cursor++;
          const item = selected[idx];
          if (item.url.includes('news.google.com/')) {
            const resolved = await resolveGoogleNewsUrl(item.url, signal);
            if (resolved) item.url = resolved;
          }
        }
      });
      await Promise.all(workers);
      return selected;
    };

    const searchNaverNews = async (signal: AbortSignal): Promise<SearchCandidate[]> => {
      if (region === 'en') return [];
      const nowMs = Date.now();
      const deStr = toKstDateStr(nowMs).replace(/-/g, '.');
      let dateParams = '';
      if (period !== 'all') {
        const days = period === '30d' ? 30 : period === '1y' ? 365 : 730;
        const dsStr = toKstDateStr(nowMs - days * 86_400_000).replace(/-/g, '.');
        dateParams = `&pd=3&ds=${dsStr}&de=${deStr}`;
      }

      const starts = limit > 30 ? [1, 11, 21] : [1, 11];
      const pages = await Promise.all(
        starts.map(async (start) => {
          try {
            const naverUrl = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(rawQuery)}&sort=1${dateParams}&start=${start}`;
            const response = await fetch(naverUrl, {
              method: 'GET',
              signal,
              headers: {
                'User-Agent': BROWSER_UA,
                Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9',
              },
            });
            if (!response.ok) return [] as SearchCandidate[];
            const html = await readBodyWithLimit(response, 1.5 * 1024 * 1024);
            const blocks = html.split(/(?=<div[^>]+sds-comps-profile-info-title)/);
            const items: SearchCandidate[] = [];

            for (const block of blocks.slice(1)) {
              const rawProf =
                block.match(/data-heatmap-target="\.prof"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '';
              const pressName = decodeHtmlEntities(
                rawProf.replace(/<[^>]+>/g, ' ').replace(/새 창 열림/g, ''),
              );
              const rawTime =
                block.match(
                  /sds-comps-profile-info-subtexts[\s\S]*?<span[^>]+sds-comps-text-ellipsis[^>]*>([\s\S]*?)<\/span>/,
                )?.[1] ?? '';
              const timeText = decodeHtmlEntities(rawTime.replace(/<[^>]+>/g, ' '));
              const keepUrl = block.match(
                /class="[^"]*_keep_trigger[^"]*"[^>]*data-url="([^"]+)"/,
              )?.[1];
              const titMatch = block.match(
                /<a[^>]+href="([^"]+)"[^>]*data-heatmap-target="\.tit"[^>]*>([\s\S]*?)<\/a>/,
              );
              const rawTitle = titMatch?.[2] ?? '';
              const cleanTitle = decodeHtmlEntities(
                rawTitle.replace(/<[^>]+>/g, ' ').replace(/새 창 열림/g, ''),
              );
              const rawHref = keepUrl || titMatch?.[1] || '';
              const validUrl = cleanTrackedUrl(decodeHtmlEntities(rawHref));

              if (!cleanTitle || !validUrl) continue;
              const { date, timestamp, iso } = parseNaverDateText(timeText, nowMs);
              items.push({
                title: cleanTitle,
                url: validUrl,
                date,
                source: pressName || '네이버 뉴스',
                publishedAt: iso,
                timestamp,
                providers: ['naver'],
              });
            }
            return items;
          } catch {
            return [] as SearchCandidate[];
          }
        }),
      );

      return pages.flat();
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11000);

    try {
      const [googleRes, naverRes] = await Promise.allSettled([
        searchGoogleNews(controller.signal),
        searchNaverNews(controller.signal),
      ]);

      const googleItems = googleRes.status === 'fulfilled' ? googleRes.value : [];
      const naverItems = naverRes.status === 'fulfilled' ? naverRes.value : [];

      if (googleItems.length === 0 && naverItems.length === 0) {
        if (googleRes.status === 'rejected' && naverRes.status === 'rejected') {
          res.status(502).json({ error: '뉴스 검색 서버에 연결하지 못했습니다.' });
          return;
        }
        res.json({ query: rawQuery, period, region, items: [] });
        return;
      }

      // Merge & deduplicate across Google and Naver
      const merged: Array<SearchCandidate & { urlKey: string; titleKey: string }> = [];
      const urlIndex = new Map<string, number>();

      const isTruncatedTitle = (t: string) => /(\.\.\.|…)$/.test(t.trim());
      const urlCleanlinessScore = (u: string): number => {
        if (u.includes('news.google.com/')) return 0;
        if (u.includes('n.news.naver.com/')) return 1;
        if (/[?&](input|ref)=/.test(u)) return 2;
        return 3;
      };

      for (const item of [...googleItems, ...naverItems]) {
        const urlKey = canonicalUrlKey(item.url);
        const titleKey = normalizeTitleKey(item.title);
        if (!titleKey) continue;

        let dupIdx = urlIndex.get(urlKey);
        if (dupIdx === undefined) {
          for (let i = 0; i < merged.length; i++) {
            const existing = merged[i];
            if (existing.titleKey === titleKey) {
              dupIdx = i;
              break;
            }
            const shorter = Math.min(existing.titleKey.length, titleKey.length);
            if (
              shorter >= 14 &&
              (existing.titleKey.startsWith(titleKey) || titleKey.startsWith(existing.titleKey))
            ) {
              dupIdx = i;
              break;
            }
            const within3Days =
              !existing.timestamp ||
              !item.timestamp ||
              Math.abs(existing.timestamp - item.timestamp) <= 3 * 86_400_000;
            if (within3Days && shorter >= 12 && bigramSimilarity(existing.titleKey, titleKey) >= 0.82) {
              dupIdx = i;
              break;
            }
          }
        }

        if (dupIdx !== undefined) {
          const existing = merged[dupIdx];
          for (const p of item.providers) {
            if (!existing.providers.includes(p)) existing.providers.push(p);
          }
          // Prefer full non-truncated title
          const existingTrunc = isTruncatedTitle(existing.title);
          const incomingTrunc = isTruncatedTitle(item.title);
          if ((existingTrunc && !incomingTrunc) || (!existingTrunc && !incomingTrunc && item.title.length > existing.title.length)) {
            existing.title = item.title;
            existing.titleKey = titleKey;
          }
          // Prefer cleaner direct publisher URL
          if (urlCleanlinessScore(item.url) > urlCleanlinessScore(existing.url)) {
            existing.url = item.url;
            existing.urlKey = urlKey;
            urlIndex.set(urlKey, dupIdx);
          }
          if (!existing.date && item.date) {
            existing.date = item.date;
            existing.timestamp = item.timestamp;
            existing.publishedAt = item.publishedAt;
          }
          if ((!existing.source || existing.source === 'Google 뉴스' || existing.source === '네이버 뉴스') && item.source) {
            existing.source = item.source;
          }
        } else {
          const nextIdx = merged.length;
          merged.push({ ...item, urlKey, titleKey });
          urlIndex.set(urlKey, nextIdx);
        }
      }

      merged.sort((a, b) => b.timestamp - a.timestamp);
      const topMerged = merged.slice(0, limit);

      // Expand truncated Naver-only headlines (up to 10) via safe metadata lookup
      const truncatedTargets = topMerged.filter((m) => isTruncatedTitle(m.title)).slice(0, 10);
      if (truncatedTargets.length > 0) {
        await Promise.all(
          truncatedTargets.map(async (target) => {
            try {
              const meta = await fetchSingleMeta(target.url);
              if (meta.title && meta.title.length > target.title.length - 3) {
                target.title = meta.title;
              }
            } catch {
              // keep snippet title on error
            }
          }),
        );
      }

      const items = topMerged.map(({ timestamp: _ts, urlKey: _uk, titleKey: _tk, ...rest }) => rest);

      res.json({ query: rawQuery, period, region, items });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '최신 뉴스 검색 중 오류가 발생했습니다.',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get('/api/local-archive/stocks', async (req, res) => {
    if (!isLocalOnlyRequest(req)) {
      res.status(403).json({ error: '로컬 환경에서만 사용할 수 있습니다.' });
      return;
    }
    try {
      const targetPath = resolveLocalDataPath('stocks-archive.json');
      const raw = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        res.json({ exists: false });
        return;
      }
      res.json({ exists: true, stocks: parsed });
    } catch {
      res.json({ exists: false });
    }
  });

  app.post(
    '/api/local-archive/stocks',
    express.json({ limit: '100mb' }),
    async (req, res) => {
      if (!isLocalOnlyRequest(req)) {
        res.status(403).json({ error: '로컬 환경에서만 사용할 수 있습니다.' });
        return;
      }
      const body = req.body as { stocks?: unknown; markdown?: unknown };
      if (!Array.isArray(body?.stocks)) {
        res.status(400).json({ error: '유효한 종목 배열이 필요합니다.' });
        return;
      }
      const stocksValid = body.stocks.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          typeof (item as { name?: unknown }).name === 'string' &&
          Array.isArray((item as { news?: unknown }).news),
      );
      if (!stocksValid) {
        res.status(400).json({ error: '종목 데이터 형식이 올바르지 않습니다.' });
        return;
      }

      try {
        const archivePath = resolveLocalDataPath('stocks-archive.json');
        await atomicWriteLocalFile(archivePath, JSON.stringify(body.stocks));
        if (typeof body.markdown === 'string') {
          const mdPath = resolveLocalDataPath('종목뉴스_전체.md');
          await atomicWriteLocalFile(mdPath, body.markdown);
        }
        res.json({ ok: true, count: body.stocks.length });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : '로컬 파일 저장 실패',
        });
      }
    },
  );

  app.get('/api/local-archive/config', async (req, res) => {
    if (!isLocalOnlyRequest(req)) {
      res.status(403).json({ error: '로컬 환경에서만 사용할 수 있습니다.' });
      return;
    }
    try {
      const targetPath = resolveLocalDataPath('config.json');
      const raw = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        res.json({ exists: false });
        return;
      }
      res.json({ exists: true, config: parsed });
    } catch {
      res.json({ exists: false });
    }
  });

  app.post(
    '/api/local-archive/config',
    express.json({ limit: '128kb' }),
    async (req, res) => {
      if (!isLocalOnlyRequest(req)) {
        res.status(403).json({ error: '로컬 환경에서만 사용할 수 있습니다.' });
        return;
      }
      const body = req.body as { config?: unknown };
      if (!body?.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
        res.status(400).json({ error: '유효한 설정 객체가 필요합니다.' });
        return;
      }
      try {
        const configPath = resolveLocalDataPath('config.json');
        await atomicWriteLocalFile(configPath, JSON.stringify(body.config, null, 2));
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : '설정 저장 실패',
        });
      }
    },
  );

  app.post(
    '/api/local-shutdown',
    express.json({ limit: '4kb' }),
    (req, res) => {
      if (!isLocalOnlyRequest(req)) {
        res.status(403).json({ error: '로컬 환경에서만 사용할 수 있습니다.' });
        return;
      }
      const origin = req.get('origin');
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
        res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
        return;
      }
      const body = req.body as { confirm?: unknown };
      if (body?.confirm !== 'shutdown') {
        res.status(400).json({ error: '유효하지 않은 종료 요청입니다.' });
        return;
      }
      res.json({ ok: true });
      setTimeout(() => {
        process.exit(0);
      }, 150);
    },
  );

  app.get('/api/pc-bundle', async (_req, res) => {
    const allowedRootFiles = [
      'package.json',
      'index.html',
      'tsconfig.json',
      'vite.config.ts',
      'server.ts',
      '.gitignore',
      '.env.example',
      'metadata.json',
      'start_jongmok_note.bat',
      'stop_jongmok_note.bat',
      'create_desktop_icon.bat',
      'jongmok_note.ico',
    ];

    try {
      const zip = new JSZip();
      const rootDir = path.resolve(__dirname);

      for (const fileName of allowedRootFiles) {
        const fullPath = path.resolve(rootDir, fileName);
        if (!fullPath.startsWith(rootDir + path.sep)) continue;
        try {
          const stat = await fs.lstat(fullPath);
          if (stat.isFile() && !stat.isSymbolicLink()) {
            const data = await fs.readFile(fullPath);
            zip.file(fileName, data);
          }
        } catch {
          // skip optional missing file
        }
      }
      zip.file('.npmrc', 'legacy-peer-deps=true\n');

      const srcDir = path.resolve(rootDir, 'src');
      const addDirectoryToZip = async (dirPath: string, zipPrefix: string) => {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const fullEntryPath = path.resolve(dirPath, entry.name);
          if (!fullEntryPath.startsWith(srcDir + path.sep)) continue;
          const relZipPath = `${zipPrefix}/${entry.name}`;
          if (entry.isDirectory()) {
            await addDirectoryToZip(fullEntryPath, relZipPath);
          } else if (entry.isFile()) {
            const data = await fs.readFile(fullEntryPath);
            zip.file(relZipPath, data);
          }
        }
      };

      try {
        const srcStat = await fs.lstat(srcDir);
        if (srcStat.isDirectory() && !srcStat.isSymbolicLink()) {
          await addDirectoryToZip(srcDir, 'src');
        }
      } catch {
        res.status(404).json({ error: '소스 폴더를 찾을 수 없습니다.' });
        return;
      }

      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', 'attachment; filename="jongmok-note-pc.zip"');
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : '설치 파일 생성 실패',
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
