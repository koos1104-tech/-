import CFB from 'cfb';
import JSZip from 'jszip';
import { StockItem } from '../types/stock';
import {
  UNCLASSIFIED_STOCK_NAME,
  extractDateFromContent,
  isHtmlOrNoiseLine,
  isInvalidStockHeading,
  isStandaloneDateLine,
  normalizeStockNameKey,
  stripDecorativeDividers,
} from './markdownEngine';

export interface DocParseResult {
  markdownText: string;
  formatLabel: string;
  itemCount: number;
}

interface ExtractedRow {
  stockName?: string;
  date?: string;
  title: string;
  url: string;
  memo?: string;
}

type Token =
  | { type: 'heading'; text: string }
  | { type: 'date'; date: string }
  | { type: 'entry'; row: ExtractedRow };

function decodeTextBuffer(bytes: Uint8Array, declaredCharset?: string): string {
  const tryUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const charset = declaredCharset?.toLowerCase() || '';
  if (charset.includes('euc-kr') || charset.includes('ks_c_5601') || charset.includes('cp949')) {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      return tryUtf8;
    }
  }
  const replacementCount = (tryUtf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > 2) {
    try {
      return new TextDecoder('euc-kr').decode(bytes);
    } catch {
      return tryUtf8;
    }
  }
  return tryUtf8;
}

function cleanText(text: string): string {
  return stripDecorativeDividers(
    text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function stripBulletPrefix(text: string): string {
  return text
    .replace(/^\s*(?:[-*+•▪▶◆■●○★☆※‣⁃📌📰]|\d{1,3}[.)]|\(\d{1,3}\))\s*/, '')
    .trim();
}

function extractDateFromText(text: string, url = ''): string | undefined {
  return extractDateFromContent(text, url);
}

function isLikelyDateOnly(text: string): boolean {
  return isStandaloneDateLine(text);
}

function isLikelyHeaderOrNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isHtmlOrNoiseLine(t)) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  if (
    /^(no\.?|번호|순번|구분|날짜|일자|종목|종목명|기업명|회사명|제목|기사제목|뉴스|뉴스제목|뉴스내용|내용|링크|하이퍼링크|url|비고|메모|출처)$/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function isGenericLinkLabel(label: string): boolean {
  const t = cleanText(label).toLowerCase();
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  return /^(링크|기사|기사링크|기사보기|원문|원문보기|뉴스|뉴스링크|바로가기|클릭|보기|url|link|source|more|read more|\[?링크\]?|\[?원문\]?)$/i.test(
    t,
  );
}

function matchExistingStockExact(
  rawText: string,
  existingStocks: StockItem[],
): StockItem | undefined {
  const cleaned = stripBulletPrefix(cleanText(rawText))
    .replace(/^[\[(]/, '')
    .replace(/[\])]$/, '')
    .trim();
  if (!cleaned) return undefined;

  // Strip trailing ticker in parens/brackets e.g. "삼성전자 (005930)" -> "삼성전자"
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
  const tickerMatch = cleaned.match(/[\[(](\d{6}|[A-Z]{2,5}(?:\.[A-Z]{1,2})?)[\])]\s*$/);
  const hasValidTicker =
    Boolean(tickerMatch) && !nonTickerTags.has((tickerMatch?.[1] || '').toUpperCase());
  const baseName = hasValidTicker && tickerMatch ? cleaned.slice(0, tickerMatch.index).trim() : cleaned;
  const ticker = hasValidTicker && tickerMatch ? tickerMatch[1].toUpperCase() : '';
  const krxTicker = /^\d{6}$/.test(ticker) ? ticker : '';
  const cleanedKey = normalizeStockNameKey(cleaned);
  const baseKey = normalizeStockNameKey(baseName);

  for (const s of existingStocks) {
    if (krxTicker && s.ticker && s.ticker.toUpperCase() === krxTicker) return s;
    if (normalizeStockNameKey(s.name) === cleanedKey) return s;
    if (normalizeStockNameKey(s.name) === baseKey) return s;
    if (s.ticker && /^\d{6}$/.test(s.ticker) && s.ticker.toLowerCase() === cleaned.toLowerCase()) return s;
    if (s.aliases.some((a) => normalizeStockNameKey(a) === baseKey)) return s;
  }
  return undefined;
}

function isLikelyStockHeading(
  rawText: string,
  existingStocks: StockItem[],
  formattingHint = false,
): boolean {
  if (/^\s*[📌📰]/.test(rawText)) return false;
  const cleaned = stripBulletPrefix(cleanText(rawText));
  if (!cleaned || /https?:\/\//i.test(cleaned)) return false;
  if (isLikelyDateOnly(cleaned) || isLikelyHeaderOrNoise(cleaned) || isInvalidStockHeading(cleaned)) {
    return false;
  }

  // 1. Exact match against known/remembered stocks
  if (matchExistingStockExact(cleaned, existingStocks)) return true;

  // 2. Explicit stock + ticker pattern e.g. "삼성전자 (005930)", "알테오젠 [196170]", "NVDA"
  if (/^.{1,30}\s*[\[(](?:\d{6}|[A-Z]{1,5})[\])]$/.test(cleaned)) return true;

  // 3. Reject obvious sentences / headlines
  if (cleaned.length > 36) return false;
  if (/^\[(?:단독|특징주|속보|공시|종합|기획|인터뷰|1보|2보)\]/.test(cleaned)) return false;
  if (/[,"'“”‘’!?…·]/.test(cleaned) && cleaned.length > 16) return false;
  if (/[.!?…]$/.test(cleaned)) return false;
  if (
    /(?:수주|공시|실적|전망|계약|매출|영업이익|흑자|적자|배당|소각|증자|임상|특허|허가|출시|개발|공급|납품|투자|증설|인수|합병|리포트|목표가|투자의견|급등|급락|상승|하락|돌파|체결|협력|파트너|선정|인증|통과|확정|승인|재개|중단|발표|기대|공개|성공|우려|전환|확대)/.test(
      cleaned,
    )
  ) {
    return false;
  }

  if (formattingHint) {
    return cleaned.length <= 32;
  }

  // Standalone short company name (e.g., "삼성전자", "SK하이닉스", "한화에어로스페이스")
  const words = cleaned.split(/\s+/);
  return cleaned.length <= 18 && words.length <= 2;
}

function canonicalStockHeading(rawText: string, existingStocks: StockItem[]): string {
  const matched = matchExistingStockExact(rawText, existingStocks);
  if (matched) {
    return matched.ticker ? `${matched.name} (${matched.ticker})` : matched.name;
  }
  return stripBulletPrefix(cleanText(rawText));
}

function buildMarkdownFromTokens(tokens: Token[]): { markdownText: string; itemCount: number } {
  const lines: string[] = [];
  let currentStock = '';
  let currentDate = '';
  let itemCount = 0;

  for (const tok of tokens) {
    if (tok.type === 'heading') {
      const name = cleanText(tok.text);
      if (name && name !== currentStock) {
        if (lines.length > 0) lines.push('');
        lines.push(`# ${name}`);
        currentStock = name;
        currentDate = '';
      }
      continue;
    }

    if (tok.type === 'date') {
      currentDate = tok.date;
      continue;
    }

    const row = tok.row;
    const stockForRow = row.stockName ? cleanText(row.stockName) : '';
    if (stockForRow && stockForRow !== currentStock && !isInvalidStockHeading(stockForRow)) {
      if (lines.length > 0) lines.push('');
      lines.push(`# ${stockForRow}`);
      currentStock = stockForRow;
    } else if (!currentStock) {
      lines.push(`# ${UNCLASSIFIED_STOCK_NAME}`);
      currentStock = UNCLASSIFIED_STOCK_NAME;
    }

    const dateStr = row.date || currentDate;
    const datePrefix = dateStr ? `${dateStr} | ` : '';
    const title = cleanText(row.title) || row.url;
    const memoSuffix = row.memo && cleanText(row.memo) ? ` — ${cleanText(row.memo)}` : '';
    lines.push(`- ${datePrefix}[${title}](${row.url})${memoSuffix}`);
    itemCount++;
  }

  return { markdownText: lines.join('\n'), itemCount };
}

interface ParsedParaUnit {
  links: Array<{ title: string; url: string }>;
  plainText: string;
  formattingHint: boolean;
}

/**
 * Shared sequential processor:
 * Understands:
 *   종목명 (heading / bold / known stock / standalone short stock name)
 *     뉴스내용 + 하이퍼링크 (same line, or news text line followed by URL/link line!)
 */
function processUnitsIntoTokens(
  units: ParsedParaUnit[],
  existingStocks: StockItem[],
): Token[] {
  const tokens: Token[] = [];
  let pendingNewsLines: string[] = [];

  const isBareUrlUnit = (u: ParsedParaUnit | undefined): boolean => {
    if (!u || u.links.length === 0) return false;
    if (u.plainText) return false;
    return u.links.every((l) => isGenericLinkLabel(l.title));
  };

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const nextUnit = units[i + 1];

    if (unit.links.length === 0) {
      const raw = unit.plainText;
      if (!raw || isLikelyHeaderOrNoise(raw)) {
        pendingNewsLines = [];
        continue;
      }

      if (isLikelyDateOnly(raw)) {
        const d = extractDateFromText(raw);
        if (d) tokens.push({ type: 'date', date: d });
        continue;
      }

      // If the NEXT unit is a bare URL / generic link label, this text is its news content/title (NOT a stock heading)
      if (isBareUrlUnit(nextUnit) && !matchExistingStockExact(raw, existingStocks)) {
        pendingNewsLines.push(stripBulletPrefix(raw));
        continue;
      }

      // Check if this line is a listed company stock name (if unstyled & unknown, only when not inside pending news)
      const isKnownOrTicker =
        Boolean(matchExistingStockExact(raw, existingStocks)) ||
        /[\[(](?:\d{6}|[A-Z]{1,5})[\])]$/.test(raw.trim());
      if (
        (isKnownOrTicker || unit.formattingHint || pendingNewsLines.length === 0) &&
        isLikelyStockHeading(raw, existingStocks, unit.formattingHint)
      ) {
        pendingNewsLines = [];
        tokens.push({
          type: 'heading',
          text: canonicalStockHeading(raw, existingStocks),
        });
        continue;
      }

      // Otherwise treat as pending news content/headline waiting for the upcoming hyperlink
      pendingNewsLines.push(stripBulletPrefix(raw));
      continue;
    }

    // Unit has 1 or more hyperlinks
    const dateInLine = extractDateFromText(unit.plainText);
    const cleanedRest = stripBulletPrefix(
      unit.plainText
        .replace(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?\.?/g, '')
        .replace(/^[|\-–—·:\s]+|[|\-–—·:\s]+$/g, '')
        .trim(),
    );

    // Check if plainText starts with "종목명 | ..." or "종목명 : ..." or "종목명 - ..."
    let inlineStock = '';
    let restNewsText = cleanedRest;
    const prefixMatch = cleanedRest.match(/^([^\-|:\[\]]{1,28})\s*(?:\||:|-{1,2}|–|—)\s*(.+)$/);
    if (prefixMatch && isLikelyStockHeading(prefixMatch[1], existingStocks, false)) {
      inlineStock = canonicalStockHeading(prefixMatch[1], existingStocks);
      restNewsText = prefixMatch[2].trim();
    } else if (
      cleanedRest &&
      isLikelyStockHeading(cleanedRest, existingStocks, false) &&
      unit.links.every((l) => !isGenericLinkLabel(l.title))
    ) {
      inlineStock = canonicalStockHeading(cleanedRest, existingStocks);
      restNewsText = '';
    }

    const pendingText = pendingNewsLines.join(' ').trim();
    const pendingDate = pendingText ? extractDateFromText(pendingText) : undefined;
    const cleanedPending = pendingText
      .replace(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?\.?/g, '')
      .replace(/^[|\-–—·:\s]+|[|\-–—·:\s]+$/g, '')
      .trim();

    for (const link of unit.links) {
      const hasTitle = !isGenericLinkLabel(link.title);

      let finalTitle = link.title;
      let finalMemo = '';

      if (hasTitle) {
        if (restNewsText && restNewsText !== link.title) {
          if (link.title.length <= 12 && restNewsText.length > link.title.length) {
            finalTitle = `${restNewsText} (${link.title})`;
          } else {
            finalMemo = restNewsText;
          }
        }
        if (cleanedPending) {
          finalMemo = finalMemo ? `${cleanedPending} · ${finalMemo}` : cleanedPending;
        }
      } else {
        finalTitle = restNewsText || cleanedPending || link.url;
        if (restNewsText && cleanedPending) {
          finalMemo = cleanedPending;
        }
      }

      const detectedDate =
        dateInLine ||
        pendingDate ||
        extractDateFromText(`${finalTitle} ${finalMemo}`, link.url);

      tokens.push({
        type: 'entry',
        row: {
          stockName: inlineStock || undefined,
          date: detectedDate,
          title: finalTitle,
          url: link.url,
          memo: finalMemo || undefined,
        },
      });
    }

    pendingNewsLines = [];
  }

  return tokens;
}

function parseFieldHyperlinksFromLine(rawLine: string): {
  links: Array<{ title: string; url: string }>;
  plainText: string;
} {
  const links: Array<{ title: string; url: string }> = [];
  let resultPlain = '';
  let i = 0;

  while (i < rawLine.length) {
    if (rawLine[i] === '\x13') {
      // Scan balanced \x13 ... \x15 field block
      let depth = 1;
      let j = i + 1;
      let sepPos = -1;
      while (j < rawLine.length && depth > 0) {
        const ch = rawLine[j];
        if (ch === '\x13') depth++;
        else if (ch === '\x15') depth--;
        else if (ch === '\x14' && depth === 1 && sepPos === -1) sepPos = j;
        j++;
      }

      if (depth === 0) {
        const instr = sepPos !== -1 ? rawLine.slice(i + 1, sepPos) : rawLine.slice(i + 1, j - 1);
        const display = sepPos !== -1 ? rawLine.slice(sepPos + 1, j - 1) : '';
        const urlMatch =
          instr.match(/HYPERLINK\s+(?:\\[a-z]\s+)*"([^"]+)"/i) ||
          instr.match(/HYPERLINK\s+(?:\\[a-z]\s+)*(https?:\/\/[^\s\x14\x15"]+)/i);
        if (urlMatch?.[1] && /^https?:\/\//i.test(urlMatch[1].trim())) {
          const cleanUrl = urlMatch[1].trim();
          const cleanDisplay = cleanText(display.replace(/[\x13\x14\x15]/g, ''));
          links.push({ title: cleanDisplay || cleanUrl, url: cleanUrl });
        } else if (display.trim()) {
          resultPlain += display.replace(/[\x13\x14\x15]/g, '') + ' ';
        }
        i = j;
        continue;
      }
    }
    resultPlain += rawLine[i];
    i++;
  }

  // Detect bare URLs inside remaining plain text
  resultPlain = resultPlain
    .replace(/(https?:\/\/[^\s<>()"\x07\r\n]+)/gi, (rawUrl) => {
      const cleanUrl = rawUrl.replace(/[.,;]+$/, '');
      links.push({ title: '', url: cleanUrl });
      return '';
    })
    .replace(/\(\s*\)|\[\s*\]/g, ' ');

  return { links, plainText: cleanText(resultPlain) };
}

async function parseDocxBuffer(
  buffer: ArrayBuffer,
  existingStocks: StockItem[],
): Promise<DocParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  const relsFile = zip.file('word/_rels/document.xml.rels');
  const docFile = zip.file('word/document.xml');

  if (!docFile) {
    if (zip.file('package.json')) {
      throw new Error(
        '이 파일은 PC 설치용 압축 파일(.zip)입니다. 앱 안에 불러오지 마시고, 내 컴퓨터 폴더에 압축을 푼 뒤 start_jongmok_note.bat 파일을 더블클릭해 실행하세요.',
      );
    }
    throw new Error('지원하지 않는 압축 포맷입니다. Word(.doc / .docx) 또는 Markdown(.md) 파일을 올려주세요.');
  }

  const relMap = new Map<string, string>();
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const relsDoc = new DOMParser().parseFromString(relsXml, 'text/xml');
    const relNodes = Array.from(relsDoc.getElementsByTagName('Relationship'));
    for (const rel of relNodes) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target && /^https?:\/\//i.test(target.trim())) {
        relMap.set(id, target.trim());
      }
    }
  }

  const docXml = await docFile.async('string');
  const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml');
  const body = xmlDoc.getElementsByTagNameNS('*', 'body')[0] || xmlDoc.documentElement;

  const extractParagraphUnits = (pEl: Element): ParsedParaUnit[] => {
    const pStyleEl = pEl.getElementsByTagNameNS('*', 'pStyle')[0];
    const styleVal = pStyleEl?.getAttribute('w:val') || pStyleEl?.getAttribute('val') || '';
    const isHeadingStyle = /heading|title|제목/i.test(styleVal);

    const lineUnits: ParsedParaUnit[] = [];
    let currentLinks: Array<{ title: string; url: string }> = [];
    let plainChunks: string[] = [];
    let totalRuns = 0;
    let boldRuns = 0;

    let fieldDepth = 0;
    let inFieldResult = false;
    let fieldInstr = '';
    let fieldResultText = '';

    const pushCurrentLine = () => {
      const combinedPlain = cleanText(plainChunks.join(''));
      const lineLinks = [...currentLinks];
      const finalPlain = combinedPlain
        .replace(/(https?:\/\/[^\s<>()]+)/gi, (rawUrl) => {
          const cleaned = rawUrl.replace(/[.,;]+$/, '');
          lineLinks.push({ title: '', url: cleaned });
          return '';
        })
        .replace(/\(\s*\)|\[\s*\]/g, ' ');
      const cleanPlain = cleanText(finalPlain);
      const isBold = totalRuns > 0 && boldRuns === totalRuns;
      if (lineLinks.length > 0 || cleanPlain) {
        lineUnits.push({
          links: lineLinks,
          plainText: cleanPlain,
          formattingHint: isHeadingStyle || isBold,
        });
      }
      currentLinks = [];
      plainChunks = [];
      totalRuns = 0;
      boldRuns = 0;
    };

    const walkParagraphChild = (node: Element) => {
      const localName = node.localName;
      if (localName === 'Fallback') return;

      if (localName === 'hyperlink') {
        const rId =
          node.getAttribute('r:id') ||
          node.getAttributeNS(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
            'id',
          ) ||
          '';
        const url = relMap.get(rId) || '';
        const text = Array.from(node.getElementsByTagNameNS('*', 't'))
          .map((t) => t.textContent || '')
          .join('')
          .trim();
        if (url) {
          currentLinks.push({ title: cleanText(text) || url, url });
        } else if (text) {
          plainChunks.push(text);
        }
        return;
      }

      if (localName === 'fldSimple') {
        const instr = node.getAttribute('w:instr') || node.getAttribute('instr') || '';
        const urlMatch = instr.match(/HYPERLINK\s+(?:\\[a-z]\s+)*"([^"]+)"/i);
        const text = Array.from(node.getElementsByTagNameNS('*', 't'))
          .map((t) => t.textContent || '')
          .join('')
          .trim();
        if (urlMatch?.[1] && /^https?:\/\//i.test(urlMatch[1])) {
          currentLinks.push({ title: cleanText(text) || urlMatch[1], url: urlMatch[1] });
        } else if (text) {
          plainChunks.push(text);
        }
        return;
      }

      if (localName === 'r') {
        const fldChar = node.getElementsByTagNameNS('*', 'fldChar')[0];
        if (fldChar) {
          const fldType =
            fldChar.getAttribute('w:fldCharType') || fldChar.getAttribute('fldCharType');
          if (fldType === 'begin') {
            fieldDepth++;
            if (fieldDepth === 1) {
              inFieldResult = false;
              fieldInstr = '';
              fieldResultText = '';
            }
          } else if (fldType === 'separate' && fieldDepth === 1) {
            inFieldResult = true;
          } else if (fldType === 'end') {
            if (fieldDepth === 1) {
              const urlMatch =
                fieldInstr.match(/HYPERLINK\s+(?:\\[a-z]\s+)*"([^"]+)"/i) ||
                fieldInstr.match(/HYPERLINK\s+(?:\\[a-z]\s+)*(https?:\/\/[^\s"]+)/i);
              if (urlMatch?.[1] && /^https?:\/\//i.test(urlMatch[1])) {
                currentLinks.push({
                  title: cleanText(fieldResultText) || urlMatch[1],
                  url: urlMatch[1],
                });
              } else if (fieldResultText.trim()) {
                plainChunks.push(fieldResultText);
              }
              inFieldResult = false;
              fieldInstr = '';
              fieldResultText = '';
            }
            if (fieldDepth > 0) fieldDepth--;
          }
          return;
        }

        const instrText = Array.from(node.getElementsByTagNameNS('*', 'instrText'))
          .map((el) => el.textContent || '')
          .join('');
        if (fieldDepth > 0 && instrText) {
          fieldInstr += instrText;
          return;
        }

        let runBuf = '';
        let hasLineBreak = false;
        for (const rc of Array.from(node.children)) {
          if (rc.localName === 't') {
            runBuf += rc.textContent || '';
          } else if (rc.localName === 'tab') {
            runBuf += ' ';
          } else if (rc.localName === 'br' || rc.localName === 'cr') {
            if (fieldDepth > 0 && inFieldResult) {
              fieldResultText += runBuf + ' ';
              runBuf = '';
            } else {
              if (runBuf) {
                plainChunks.push(runBuf);
                runBuf = '';
              }
              pushCurrentLine();
              hasLineBreak = true;
            }
          }
        }

        if (fieldDepth > 0 && inFieldResult) {
          fieldResultText += runBuf;
          return;
        }

        if (runBuf.trim()) {
          totalRuns++;
          const rPr = node.getElementsByTagNameNS('*', 'rPr')[0];
          const bEl = rPr?.getElementsByTagNameNS('*', 'b')[0];
          const bVal = bEl?.getAttribute('w:val') || bEl?.getAttribute('val');
          if (bEl && bVal !== '0' && bVal !== 'false') {
            boldRuns++;
          }
        }
        if (runBuf || !hasLineBreak) {
          plainChunks.push(runBuf);
        }
        return;
      }

      // Recurse into wrappers like <w:ins>, <w:sdt>, <w:sdtContent>, <w:smartTag>, <mc:AlternateContent>, <mc:Choice>
      if (
        localName === 'ins' ||
        localName === 'sdt' ||
        localName === 'sdtContent' ||
        localName === 'smartTag' ||
        localName === 'customXml' ||
        localName === 'AlternateContent' ||
        localName === 'Choice'
      ) {
        for (const sub of Array.from(node.children)) {
          walkParagraphChild(sub);
        }
      }
    };

    for (const child of Array.from(pEl.children)) {
      walkParagraphChild(child);
    }
    pushCurrentLine();

    return lineUnits.length > 0
      ? lineUnits
      : [{ links: [], plainText: '', formattingHint: isHeadingStyle }];
  };

  const allTokens: Token[] = [];
  let pendingUnits: ParsedParaUnit[] = [];

  const flushPendingUnits = () => {
    if (pendingUnits.length > 0) {
      allTokens.push(...processUnitsIntoTokens(pendingUnits, existingStocks));
      pendingUnits = [];
    }
  };

  const processTable = (tblEl: Element) => {
    const rows = Array.from(tblEl.getElementsByTagNameNS('*', 'tr'));
    let lastTableStock = '';

    for (const tr of rows) {
      const cells = Array.from(tr.children).filter((c) => c.localName === 'tc');
      if (cells.length === 0) continue;

      const cellInfos = cells.map((tc) => {
        const pEls = Array.from(tc.getElementsByTagNameNS('*', 'p'));
        const parts = pEls.flatMap(extractParagraphUnits).filter((u) => u.links.length > 0 || u.plainText);
        const links = parts.flatMap((p) => p.links);
        const text = cleanText(parts.map((p) => p.plainText).filter(Boolean).join(' '));
        return { links, text, parts };
      });

      const allLinks = cellInfos.flatMap((c) => c.links);
      if (allLinks.length === 0) {
        const nonEmpty = cellInfos
          .map((c) => c.text)
          .filter((t) => t && !isLikelyHeaderOrNoise(t));
        if (
          nonEmpty.length === 1 &&
          isLikelyStockHeading(nonEmpty[0], existingStocks, true)
        ) {
          lastTableStock = canonicalStockHeading(nonEmpty[0], existingStocks);
          allTokens.push({ type: 'heading', text: lastTableStock });
        }
        continue;
      }

      let rowStock = '';
      let rowDate = '';
      const newsTextParts: string[] = [];
      const multiLineLinkCells: Array<(typeof cellInfos)[number]> = [];

      for (const cell of cellInfos) {
        if (cell.links.length > 0) {
          if (cell.parts.length > 1 || cell.links.length > 1) {
            multiLineLinkCells.push(cell);
          } else if (cell.text) {
            if (
              cell.links.every((l) => !isGenericLinkLabel(l.title)) &&
              !rowStock &&
              isLikelyStockHeading(cell.text, existingStocks, false)
            ) {
              rowStock = canonicalStockHeading(cell.text, existingStocks);
            } else {
              newsTextParts.push(cell.text);
            }
          }
          continue;
        }
        const t = cell.text;
        if (!t || isLikelyHeaderOrNoise(t)) continue;
        if (!rowDate && isLikelyDateOnly(t)) {
          rowDate = extractDateFromText(t) || '';
          continue;
        }
        if (!rowStock && isLikelyStockHeading(t, existingStocks, false)) {
          rowStock = canonicalStockHeading(t, existingStocks);
          continue;
        }
        newsTextParts.push(t);
      }

      if (rowStock) {
        lastTableStock = rowStock;
      } else if (lastTableStock) {
        rowStock = lastTableStock;
      }

      if (multiLineLinkCells.length > 0 && newsTextParts.length === 0) {
        for (const cell of multiLineLinkCells) {
          const cellTokens = processUnitsIntoTokens(cell.parts, existingStocks);
          for (const ct of cellTokens) {
            if (ct.type === 'entry') {
              if (!ct.row.stockName && rowStock) ct.row.stockName = rowStock;
              if (!ct.row.date && rowDate) ct.row.date = rowDate;
            }
            allTokens.push(ct);
          }
        }
        continue;
      }

      for (const link of allLinks) {
        const hasTitle = !isGenericLinkLabel(link.title);
        const textFallback = newsTextParts.join(' · ');
        const finalTitle = hasTitle ? link.title : textFallback || link.url;
        const finalMemo = hasTitle && textFallback ? textFallback : undefined;
        const detectedDate =
          rowDate ||
          extractDateFromText(`${textFallback} ${link.title}`, link.url);
        allTokens.push({
          type: 'entry',
          row: {
            stockName: rowStock || undefined,
            date: detectedDate,
            title: finalTitle,
            url: link.url,
            memo: finalMemo,
          },
        });
      }
    }
  };

  const walkBodyNode = (node: Element) => {
    const ln = node.localName;
    if (ln === 'p') {
      pendingUnits.push(...extractParagraphUnits(node));
    } else if (ln === 'tbl') {
      flushPendingUnits();
      processTable(node);
    } else if (
      ln === 'sdt' ||
      ln === 'sdtContent' ||
      ln === 'ins' ||
      ln === 'customXml' ||
      ln === 'smartTag'
    ) {
      for (const c of Array.from(node.children)) {
        walkBodyNode(c);
      }
    }
  };

  for (const child of Array.from(body.children)) {
    walkBodyNode(child);
  }
  flushPendingUnits();

  const built = buildMarkdownFromTokens(allTokens);
  return {
    markdownText: built.markdownText,
    formatLabel: 'Word (.docx)',
    itemCount: built.itemCount,
  };
}

function parseHtmlDocString(
  html: string,
  existingStocks: StockItem[],
  formatLabel = 'HTML 문서',
): DocParseResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body || doc.documentElement;

  const allTokens: Token[] = [];
  let pendingUnits: ParsedParaUnit[] = [];
  let lastTableStock = '';

  const flushPendingUnits = () => {
    if (pendingUnits.length > 0) {
      allTokens.push(...processUnitsIntoTokens(pendingUnits, existingStocks));
      pendingUnits = [];
    }
  };

  const BLOCK_TAGS = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'dd',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'li',
    'main',
    'nav',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'tr',
    'ul',
  ]);

  const hasBlockDescendant = (el: Element): boolean => {
    for (const child of Array.from(el.children)) {
      const t = child.tagName.toLowerCase();
      if (BLOCK_TAGS.has(t) || hasBlockDescendant(child)) return true;
    }
    return false;
  };

  const extractUnitsSplitByBr = (el: Element, formattingHint = false): ParsedParaUnit[] => {
    const units: ParsedParaUnit[] = [];
    let curLinks: Array<{ title: string; url: string }> = [];
    let curTextChunks: string[] = [];

    const pushSegment = () => {
      const links = [...curLinks];
      let plain = cleanText(curTextChunks.join(''));
      plain = plain
        .replace(/(https?:\/\/[^\s<>()]+)/gi, (rawUrl) => {
          links.push({ title: '', url: rawUrl.replace(/[.,;]+$/, '') });
          return '';
        })
        .replace(/\(\s*\)|\[\s*\]/g, ' ');
      plain = cleanText(plain);
      if (links.length > 0 || plain) {
        units.push({ links, plainText: plain, formattingHint });
      }
      curLinks = [];
      curTextChunks = [];
    };

    const visitInline = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        curTextChunks.push(node.textContent || '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const elem = node as Element;
      const t = elem.tagName.toLowerCase();
      if (t === 'br') {
        pushSegment();
        return;
      }
      if (t === 'a') {
        const href = (elem.getAttribute('href') || '').trim();
        const anchorText = cleanText(elem.textContent || '');
        if (/^https?:\/\//i.test(href)) {
          curLinks.push({ title: anchorText || href, url: href });
        } else if (anchorText) {
          curTextChunks.push(anchorText);
        }
        return;
      }
      for (const ch of Array.from(elem.childNodes)) {
        visitInline(ch);
      }
    };

    visitInline(el);
    pushSegment();
    return units;
  };

  const extractCellParts = (cellEl: Element): ParsedParaUnit[] => {
    const blockChildren = Array.from(cellEl.children).filter((c) =>
      BLOCK_TAGS.has(c.tagName.toLowerCase()),
    );
    if (blockChildren.length > 0) {
      return blockChildren.flatMap((bc) =>
        extractUnitsSplitByBr(bc, /^h[1-6]$/.test(bc.tagName.toLowerCase()) || Boolean(bc.querySelector('b, strong'))),
      );
    }
    return extractUnitsSplitByBr(cellEl, Boolean(cellEl.querySelector('b, strong')));
  };

  const walkNode = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'head') return;

    if (tag === 'tr') {
      flushPendingUnits();
      const cells = Array.from(el.children).filter(
        (c) => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th',
      );
      if (cells.length === 0) return;

      const cellInfos = cells.map((c) => {
        const parts = extractCellParts(c);
        const links = parts.flatMap((p) => p.links);
        const plain = cleanText(parts.map((p) => p.plainText).filter(Boolean).join(' '));
        const fullText = cleanText(c.textContent || '');
        return { links, plain, fullText, parts };
      });

      const allLinks = cellInfos.flatMap((c) => c.links);
      if (allLinks.length === 0) {
        const nonEmpty = cellInfos
          .map((c) => c.fullText)
          .filter((t) => t && !isLikelyHeaderOrNoise(t));
        if (
          nonEmpty.length === 1 &&
          isLikelyStockHeading(nonEmpty[0], existingStocks, true)
        ) {
          lastTableStock = canonicalStockHeading(nonEmpty[0], existingStocks);
          allTokens.push({ type: 'heading', text: lastTableStock });
        }
        return;
      }

      let rowStock = '';
      let rowDate = '';
      const newsTextParts: string[] = [];
      const multiLineLinkCells: Array<(typeof cellInfos)[number]> = [];

      for (const c of cellInfos) {
        if (c.links.length > 0) {
          if (c.parts.length > 1 || c.links.length > 1) {
            multiLineLinkCells.push(c);
          } else if (c.plain) {
            newsTextParts.push(c.plain);
          }
          continue;
        }
        const t = c.fullText;
        if (!t || isLikelyHeaderOrNoise(t)) continue;
        if (!rowDate && isLikelyDateOnly(t)) {
          rowDate = extractDateFromText(t) || '';
          continue;
        }
        if (!rowStock && isLikelyStockHeading(t, existingStocks, false)) {
          rowStock = canonicalStockHeading(t, existingStocks);
          continue;
        }
        newsTextParts.push(t);
      }

      if (rowStock) lastTableStock = rowStock;
      else if (lastTableStock) rowStock = lastTableStock;

      if (multiLineLinkCells.length > 0 && newsTextParts.length === 0) {
        for (const c of multiLineLinkCells) {
          const cellTokens = processUnitsIntoTokens(c.parts, existingStocks);
          for (const ct of cellTokens) {
            if (ct.type === 'entry') {
              if (!ct.row.stockName && rowStock) ct.row.stockName = rowStock;
              if (!ct.row.date && rowDate) ct.row.date = rowDate;
            }
            allTokens.push(ct);
          }
        }
        return;
      }

      for (const link of allLinks) {
        const hasTitle = !isGenericLinkLabel(link.title);
        const textFallback = newsTextParts.join(' · ');
        const finalTitle = hasTitle ? link.title : textFallback || link.url;
        const finalMemo = hasTitle && textFallback ? textFallback : undefined;
        const detectedDate =
          rowDate ||
          extractDateFromText(`${textFallback} ${link.title}`, link.url);
        allTokens.push({
          type: 'entry',
          row: {
            stockName: rowStock || undefined,
            date: detectedDate,
            title: finalTitle,
            url: link.url,
            memo: finalMemo,
          },
        });
      }
      return;
    }

    if (
      /^h[1-6]$/.test(tag) ||
      tag === 'p' ||
      tag === 'li' ||
      ((tag === 'div' || tag === 'section' || tag === 'article' || tag === 'blockquote') &&
        !hasBlockDescendant(el))
    ) {
      const isHeadingTag = /^h[1-6]$/.test(tag) || Boolean(el.querySelector('b, strong'));
      pendingUnits.push(...extractUnitsSplitByBr(el, isHeadingTag));
      return;
    }

    // Container node (e.g. body, div with block children): also collect loose inline nodes between blocks!
    let looseNodes: Node[] = [];
    const flushLooseNodes = () => {
      if (looseNodes.length === 0) return;
      const wrapper = doc.createElement('div');
      for (const ln of looseNodes) {
        wrapper.appendChild(ln.cloneNode(true));
      }
      pendingUnits.push(...extractUnitsSplitByBr(wrapper, false));
      looseNodes = [];
    };

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element;
        const childTag = childEl.tagName.toLowerCase();
        if (BLOCK_TAGS.has(childTag) || childTag === 'table' || childTag === 'tbody') {
          flushLooseNodes();
          walkNode(childEl);
          continue;
        }
      }
      looseNodes.push(child);
    }
    flushLooseNodes();
  };

  if (root) {
    walkNode(root);
    flushPendingUnits();
  }

  const built = buildMarkdownFromTokens(allTokens);
  return {
    markdownText: built.markdownText,
    formatLabel,
    itemCount: built.itemCount,
  };
}

function decodeQuotedPrintable(input: string, charset?: string): string {
  const unfolded = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unfolded.charCodeAt(i) & 0xff);
    }
  }
  return decodeTextBuffer(new Uint8Array(bytes), charset);
}

function parseMhtmlString(raw: string, existingStocks: StockItem[]): DocParseResult {
  const htmlSectionMatch = raw.match(
    /Content-Type:\s*text\/html([^\r\n]*)[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i,
  );
  const charsetMatch = (htmlSectionMatch?.[1] || raw).match(/charset=["']?([^"';\s]+)/i);
  const body = htmlSectionMatch?.[2] || raw;
  const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw);
  const decodedHtml = isQP ? decodeQuotedPrintable(body, charsetMatch?.[1]) : body;
  return parseHtmlDocString(decodedHtml, existingStocks, 'Word MHTML (.doc)');
}

function parseRtfString(raw: string, existingStocks: StockItem[]): DocParseResult {
  const text = raw.replace(/\r?\n/g, '');
  const fieldRegex = /\{\\field[\s\S]*?HYPERLINK\s+"([^"]+)"[\s\S]*?\\fldrslt\s*([^}]*)\}/gi;
  let working = text.replace(fieldRegex, (_, url: string, displayRaw: string) => {
    const cleanDisplay = cleanText(
      displayRaw
        .replace(/\\[a-z]+-?\d*\s?/gi, '')
        .replace(/[{}]/g, ''),
    );
    return `\n__LINK__${cleanDisplay || url}__URL__${url}__END__\n`;
  });

  working = working
    .replace(/\\u(-?\d+)\??/g, (_, numStr) => {
      let code = Number(numStr);
      if (code < 0) code += 65536;
      return String.fromCharCode(code);
    })
    .replace(/\\par\b|\\line\b/gi, '\n')
    .replace(/\{\\\*\\[^}]*\}/g, '')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '');

  const units: ParsedParaUnit[] = [];
  for (const line of working.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const linkMatch = t.match(/__LINK__(.*?)__URL__(.*?)__END__/);
    if (linkMatch) {
      const rest = cleanText(t.replace(linkMatch[0], ''));
      units.push({
        links: [{ title: cleanText(linkMatch[1]) || linkMatch[2], url: linkMatch[2].trim() }],
        plainText: rest,
        formattingHint: false,
      });
    } else {
      const links: Array<{ title: string; url: string }> = [];
      const plain = cleanText(
        t.replace(/https?:\/\/[^\s<>()]+/gi, (u) => {
          links.push({ title: '', url: u.replace(/[.,;]+$/, '') });
          return '';
        }),
      );
      units.push({ links, plainText: plain, formattingHint: false });
    }
  }

  const tokens = processUnitsIntoTokens(units, existingStocks);
  const built = buildMarkdownFromTokens(tokens);
  return {
    markdownText: built.markdownText,
    formatLabel: 'RTF (.doc)',
    itemCount: built.itemCount,
  };
}

function extractBinaryDocLogicalText(uint8: Uint8Array): string {
  const cfb = CFB.read(uint8, { type: 'array' });
  const wordDocEntry = CFB.find(cfb, '/WordDocument');
  if (!wordDocEntry || !wordDocEntry.content) {
    throw new Error('WordDocument 스트림을 찾을 수 없습니다.');
  }

  const wordBytes = new Uint8Array(wordDocEntry.content as Uint8Array);
  const view = new DataView(wordBytes.buffer, wordBytes.byteOffset, wordBytes.byteLength);

  if (wordBytes.length >= 0x01aa) {
    const flags = view.getUint16(0x000a, true);
    const use1Table = (flags & 0x0200) !== 0;
    const tableName = use1Table ? '/1Table' : '/0Table';
    const tableEntry =
      CFB.find(cfb, tableName) || CFB.find(cfb, use1Table ? '/0Table' : '/1Table');

    const fcClx = view.getUint32(0x01a2, true);
    const lcbClx = view.getUint32(0x01a6, true);

    if (tableEntry?.content && lcbClx > 0) {
      const tableBytes = new Uint8Array(tableEntry.content as Uint8Array);
      if (fcClx + lcbClx <= tableBytes.length) {
        const clx = tableBytes.subarray(fcClx, fcClx + lcbClx);
        let pos = 0;
        while (pos < clx.length && clx[pos] === 0x01) {
          const cbGrpprl = clx[pos + 1] | (clx[pos + 2] << 8);
          pos += 3 + cbGrpprl;
        }
        if (pos + 5 <= clx.length && clx[pos] === 0x02) {
          const pcdtView = new DataView(clx.buffer, clx.byteOffset + pos + 1, 4);
          const lcbPlcPcd = pcdtView.getUint32(0, true);
          const plcStart = pos + 5;
          if (plcStart + lcbPlcPcd <= clx.length && lcbPlcPcd >= 12) {
            const n = Math.floor((lcbPlcPcd - 4) / 12);
            const plcView = new DataView(clx.buffer, clx.byteOffset + plcStart, lcbPlcPcd);
            const cps: number[] = [];
            for (let i = 0; i <= n; i++) {
              cps.push(plcView.getUint32(i * 4, true));
            }
            const pieces: string[] = [];
            const pcdBase = (n + 1) * 4;
            for (let i = 0; i < n; i++) {
              const charCount = cps[i + 1] - cps[i];
              if (charCount <= 0) continue;
              const fcRaw = plcView.getUint32(pcdBase + i * 8 + 2, true);
              const isCompressed = (fcRaw & 0x40000000) !== 0;
              if (isCompressed) {
                const offset = (fcRaw & 0x3fffffff) >> 1;
                const end = Math.min(offset + charCount, wordBytes.length);
                let chunk = '';
                for (let b = offset; b < end; b++) {
                  chunk += String.fromCharCode(wordBytes[b]);
                }
                pieces.push(chunk);
              } else {
                const offset = fcRaw;
                const end = Math.min(offset + charCount * 2, wordBytes.length);
                const slice = wordBytes.subarray(offset, end);
                pieces.push(new TextDecoder('utf-16le').decode(slice));
              }
            }
            const joined = pieces.join('');
            if (joined.trim().length > 0) {
              return joined;
            }
          }
        }
      }
    }
  }

  return new TextDecoder('utf-16le').decode(wordBytes);
}

function parseBinaryDocBuffer(
  uint8: Uint8Array,
  existingStocks: StockItem[],
): DocParseResult {
  const logicalText = extractBinaryDocLogicalText(uint8);

  const allTokens: Token[] = [];
  let pendingUnits: ParsedParaUnit[] = [];
  let lastTableStock = '';

  const flushPendingUnits = () => {
    if (pendingUnits.length > 0) {
      allTokens.push(...processUnitsIntoTokens(pendingUnits, existingStocks));
      pendingUnits = [];
    }
  };

  const flushTableRow = (cells: string[]) => {
    const cellEntries = cells.map((c) => {
      const lines = c
        .split(/\n+/)
        .map((line) => parseFieldHyperlinksFromLine(line))
        .filter((u) => u.links.length > 0 || u.plainText);
      const links = lines.flatMap((l) => l.links);
      const plainText = cleanText(lines.map((l) => l.plainText).filter(Boolean).join(' '));
      return {
        links,
        plainText,
        parts: lines.map((l) => ({
          links: l.links,
          plainText: l.plainText,
          formattingHint: false,
        })),
      };
    });

    const allLinks = cellEntries.flatMap((c) => c.links);
    if (allLinks.length === 0) {
      const nonEmpty = cellEntries
        .map((c) => c.plainText)
        .filter((t) => t && !isLikelyHeaderOrNoise(t));
      if (
        nonEmpty.length === 1 &&
        isLikelyStockHeading(nonEmpty[0], existingStocks, true)
      ) {
        lastTableStock = canonicalStockHeading(nonEmpty[0], existingStocks);
        allTokens.push({ type: 'heading', text: lastTableStock });
      }
      return;
    }

    let rowStock = '';
    let rowDate = '';
    const newsTextParts: string[] = [];
    const multiLineLinkCells: Array<(typeof cellEntries)[number]> = [];

    for (const c of cellEntries) {
      if (c.links.length > 0) {
        if (c.parts.length > 1 || c.links.length > 1) {
          multiLineLinkCells.push(c);
        } else if (c.plainText) {
          newsTextParts.push(c.plainText);
        }
        continue;
      }
      const t = c.plainText;
      if (!t || isLikelyHeaderOrNoise(t)) continue;
      if (!rowDate && isLikelyDateOnly(t)) {
        rowDate = extractDateFromText(t) || '';
        continue;
      }
      if (!rowStock && isLikelyStockHeading(t, existingStocks, false)) {
        rowStock = canonicalStockHeading(t, existingStocks);
        continue;
      }
      newsTextParts.push(t);
    }

    if (rowStock) lastTableStock = rowStock;
    else if (lastTableStock) rowStock = lastTableStock;

    if (multiLineLinkCells.length > 0 && newsTextParts.length === 0) {
      for (const c of multiLineLinkCells) {
        const cellTokens = processUnitsIntoTokens(c.parts, existingStocks);
        for (const ct of cellTokens) {
          if (ct.type === 'entry') {
            if (!ct.row.stockName && rowStock) ct.row.stockName = rowStock;
            if (!ct.row.date && rowDate) ct.row.date = rowDate;
          }
          allTokens.push(ct);
        }
      }
      return;
    }

    for (const link of allLinks) {
      const hasTitle = !isGenericLinkLabel(link.title);
      const textFallback = newsTextParts.join(' · ');
      const finalTitle = hasTitle ? link.title : textFallback || link.url;
      const finalMemo = hasTitle && textFallback ? textFallback : undefined;
      const detectedDate =
        rowDate ||
        extractDateFromText(`${textFallback} ${link.title}`, link.url);
      allTokens.push({
        type: 'entry',
        row: {
          stockName: rowStock || undefined,
          date: detectedDate,
          title: finalTitle,
          url: link.url,
          memo: finalMemo,
        },
      });
    }
  };

  // Walk character stream tracking cells (\x07), row boundaries (\x07\x07), fields (\x13..\x15), soft breaks (\x0B) vs paragraphs (\r)
  let currentCell = '';
  let rowCells: string[] = [];
  let inTable = false;
  let fieldDepth = 0;

  const pushNonTableParagraph = (para: string) => {
    for (const subLine of para.split('\n')) {
      const parsed = parseFieldHyperlinksFromLine(subLine);
      if (parsed.links.length === 0 && !parsed.plainText) continue;
      pendingUnits.push({
        links: parsed.links,
        plainText: parsed.plainText,
        formattingHint: false,
      });
    }
  };

  for (let i = 0; i < logicalText.length; i++) {
    const ch = logicalText[i];

    if (ch === '\x13') {
      fieldDepth++;
      currentCell += ch;
      continue;
    }
    if (ch === '\x15') {
      if (fieldDepth > 0) fieldDepth--;
      currentCell += ch;
      continue;
    }

    if (ch === '\x07') {
      inTable = true;
      fieldDepth = 0;
      // Row-end marker in MS-DOC is an empty cell terminated by \x07 (i.e. \x07\x07)
      if (currentCell === '' && rowCells.length > 0) {
        flushPendingUnits();
        flushTableRow(rowCells);
        rowCells = [];
      } else {
        rowCells.push(currentCell);
        currentCell = '';
      }
      continue;
    }

    if (ch === '\x0B') {
      if (fieldDepth > 0) {
        currentCell += ' ';
      } else {
        currentCell += '\n';
      }
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && logicalText[i + 1] === '\n') i++;
      if (fieldDepth > 0) {
        currentCell += ' ';
        continue;
      }
      if (inTable) {
        if (currentCell.trim()) {
          currentCell += '\n';
        }
        // If next char is not part of a table (no \x07 in upcoming segment), row ended
        const nextBreak = logicalText.slice(i + 1, i + 400);
        if (!nextBreak.includes('\x07') && rowCells.length > 0) {
          if (currentCell.trim()) {
            rowCells.push(currentCell);
            currentCell = '';
          }
          flushPendingUnits();
          flushTableRow(rowCells);
          rowCells = [];
          inTable = false;
        }
      } else {
        pushNonTableParagraph(currentCell);
        currentCell = '';
      }
      continue;
    }

    currentCell += ch;
  }

  if (inTable && (rowCells.length > 0 || currentCell.trim())) {
    if (currentCell.trim()) rowCells.push(currentCell);
    flushPendingUnits();
    flushTableRow(rowCells);
  } else if (currentCell.trim()) {
    pushNonTableParagraph(currentCell);
  }
  flushPendingUnits();

  const built = buildMarkdownFromTokens(allTokens);
  return {
    markdownText: built.markdownText,
    formatLabel: 'Word 97-2003 (.doc)',
    itemCount: built.itemCount,
  };
}

export async function parseDocumentFile(
  file: File,
  existingStocks: StockItem[] = [],
): Promise<DocParseResult> {
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  const nameLower = file.name.toLowerCase();

  if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4b) {
    return parseDocxBuffer(buffer, existingStocks);
  }

  if (
    uint8.length >= 8 &&
    uint8[0] === 0xd0 &&
    uint8[1] === 0xcf &&
    uint8[2] === 0x11 &&
    uint8[3] === 0xe0
  ) {
    return parseBinaryDocBuffer(uint8, existingStocks);
  }

  const sampleAscii = new TextDecoder('ascii', { fatal: false }).decode(
    uint8.subarray(0, Math.min(2048, uint8.length)),
  );
  const charsetMatch = sampleAscii.match(/charset=["']?([^"';\s>]+)/i);
  const text = decodeTextBuffer(uint8, charsetMatch?.[1]);

  if (/^\s*\{\\rtf/i.test(text)) {
    return parseRtfString(text, existingStocks);
  }
  if (/MIME-Version:/i.test(text) && /Content-Type:\s*multipart\/related/i.test(text)) {
    return parseMhtmlString(text, existingStocks);
  }
  const isPlainMdExt =
    nameLower.endsWith('.md') || nameLower.endsWith('.markdown') || nameLower.endsWith('.txt');
  const looksLikeHtmlDoc = isPlainMdExt
    ? /^\s*(?:<!doctype|<html|<head|<body|<table)/i.test(text)
    : /<html[\s>]|<table[\s>]|<a\s+href=/i.test(text);
  if (looksLikeHtmlDoc) {
    return parseHtmlDocString(
      text,
      existingStocks,
      nameLower.endsWith('.doc') ? 'HTML .doc' : 'HTML',
    );
  }

  // Plain text / Markdown: strip UpNote YAML frontmatter, ===== dividers, and <br> tags
  const rawLines = text.split(/\r?\n/);
  const cleanedLines: string[] = [];
  let inFrontmatter = false;
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (inFrontmatter) {
      if (/^---+$/.test(trimmed)) {
        inFrontmatter = false;
        continue;
      }
      if (
        !trimmed ||
        (/^(?:date|created|updated|categories|tags|title)\s*:/i.test(trimmed) &&
          !/https?:\/\//i.test(trimmed)) ||
        (/^-\s+[^\[\]]+$/.test(trimmed) && !/https?:\/\//i.test(trimmed))
      ) {
        continue;
      }
      inFrontmatter = false;
    }
    if (/^---+$/.test(trimmed)) {
      let nextNonEmpty = '';
      for (let j = i + 1; j < Math.min(i + 4, rawLines.length); j++) {
        const nt = rawLines[j].trim();
        if (nt) {
          nextNonEmpty = nt;
          break;
        }
      }
      if (/^(?:date|created|updated|categories|tags|title)\s*:/i.test(nextNonEmpty)) {
        inFrontmatter = true;
        continue;
      }
    }
    if (isHtmlOrNoiseLine(trimmed)) {
      cleanedLines.push('');
    } else {
      cleanedLines.push(stripDecorativeDividers(rawLines[i]));
    }
  }
  const cleanedText = cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const baseName = file.name.replace(/\.(md|markdown|txt|doc|docx)$/i, '').trim();
  const safeBaseName =
    baseName && !isInvalidStockHeading(baseName) && !/뉴스|정리|스크랩|기사|링크|목록/i.test(baseName)
      ? baseName
      : UNCLASSIFIED_STOCK_NAME;
  const hasHeading = /^\s*#{1,2}\s+/m.test(cleanedText);
  const hasKnownStock = existingStocks.some((s) => cleanedText.includes(s.name));
  const markdownText =
    !hasHeading && !hasKnownStock ? `# ${safeBaseName}\n\n${cleanedText}` : cleanedText;
  const linkCount = (markdownText.match(/https?:\/\/\S+/gi) || []).length;
  return {
    markdownText,
    formatLabel: 'Markdown / 텍스트',
    itemCount: linkCount,
  };
}
