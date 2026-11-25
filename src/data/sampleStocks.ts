import { StockItem } from '../types/stock';
import { normalizeUrl } from '../utils/markdownEngine';

export const SAMPLE_STOCKS: StockItem[] = [
  {
    id: 'stk_samsung',
    name: '삼성전자',
    ticker: '005930',
    market: 'KOSPI',
    sector: '반도체',
    aliases: ['삼전', 'Samsung Electronics'],
    summaryNote: 'HBM4 퀄 테스트 통과 여부 및 파운드리 가동률 회복 추이 모니터링',
    updatedAt: '2026-11-22T09:00:00.000Z',
    news: [
      {
        id: 'n_ss_1',
        title: '삼성전자, 차세대 HBM4 샘플 공급 확대 및 패키지 수율 개선 발표',
        url: 'https://n.news.naver.com/mnews/article/015/0005012341',
        normalizedUrl: normalizeUrl('https://n.news.naver.com/mnews/article/015/0005012341'),
        date: '2026-11-20',
        source: '네이버뉴스',
        category: '신사업/R&D',
        memo: '1c D램 기반 로직 다이 공정 적용 확인',
        addedAt: '2026-11-20T08:30:00.000Z',
      },
      {
        id: 'n_ss_2',
        title: '삼성전자 분기보고서 (2026.09) — DS부문 설비투자 집행 내역',
        url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261114000812',
        normalizedUrl: normalizeUrl('https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261114000812'),
        date: '2026-11-14',
        source: 'DART 공시',
        category: '공시/지분',
        memo: '평택 P4 메모리 라인 우선 집행',
        addedAt: '2026-11-14T10:15:00.000Z',
      },
      {
        id: 'n_ss_3',
        title: '삼성전자, 자사주 추가 소각 및 배당 정책 이행 공시',
        url: 'https://www.hankyung.com/article/2026110841921',
        normalizedUrl: normalizeUrl('https://www.hankyung.com/article/2026110841921'),
        date: '2026-11-08',
        source: '한국경제',
        category: '주주환원',
        memo: '',
        addedAt: '2026-11-08T11:00:00.000Z',
      },
    ],
  },
  {
    id: 'stk_hynix',
    name: 'SK하이닉스',
    ticker: '000660',
    market: 'KOSPI',
    sector: '반도체',
    aliases: ['하이닉스', 'SK Hynix'],
    summaryNote: 'AI 서버용 HBM 및 eSSD 수요 지속, 청주 M15X 팹 가동 일정 추적',
    updatedAt: '2026-11-21T09:00:00.000Z',
    news: [
      {
        id: 'n_sk_1',
        title: 'SK하이닉스, 엔비디아 차세대 AI 가속기향 16단 HBM 물량 계약 체결',
        url: 'https://www.mk.co.kr/news/stock/11172840',
        normalizedUrl: normalizeUrl('https://www.mk.co.kr/news/stock/11172840'),
        date: '2026-11-21',
        source: '매일경제',
        category: '수주/계약',
        memo: '2027년 물량 장기공급계약(LTA) 포함',
        addedAt: '2026-11-21T07:40:00.000Z',
      },
      {
        id: 'n_sk_2',
        title: 'SK하이닉스 3분기 영업이익 컨센서스 상회, D램 ASP 상승세',
        url: 'https://www.sedaily.com/NewsView/2DG19K8L02',
        normalizedUrl: normalizeUrl('https://www.sedaily.com/NewsView/2DG19K8L02'),
        date: '2026-10-28',
        source: '서울경제',
        category: '실적/가이던스',
        memo: '고부가 HBM 매출 비중 40% 돌파',
        addedAt: '2026-10-28T09:20:00.000Z',
      },
    ],
  },
  {
    id: 'stk_hanwha_aero',
    name: '한화에어로스페이스',
    ticker: '012450',
    market: 'KOSPI',
    sector: '방산/우주',
    aliases: ['한화에어로', '한화방산'],
    summaryNote: '유럽 K9/천무 수주 잔고 및 지상방산 수출 마진율 체크',
    updatedAt: '2026-11-19T09:00:00.000Z',
    news: [
      {
        id: 'n_ha_1',
        title: '한화에어로스페이스, 동유럽 K9 자주포 2차 실행계약 1.4조원 수주',
        url: 'https://biz.chosun.com/industry/company/2026/11/19/K9EXPORT001/',
        normalizedUrl: normalizeUrl('https://biz.chosun.com/industry/company/2026/11/19/K9EXPORT001/'),
        date: '2026-11-19',
        source: '조선비즈',
        category: '수주/계약',
        memo: '현지 탄약 및 정비 패키지 동반 계약',
        addedAt: '2026-11-19T14:00:00.000Z',
      },
    ],
  },
];

export const SAMPLE_INCOMING_NEWS_TEXT = `- 2026-11-22 | [삼성전자, 파운드리 2나노 공정 수주 본격화](https://www.hankyung.com/article/2026112299102) — 모바일 AP 고객사 퀄 통과
- 2026-11-20 | [삼성전자, 차세대 HBM4 샘플 공급 확대 및 패키지 수율 개선 발표](https://n.news.naver.com/mnews/article/015/0005012341?utm_source=telegram)
- 2026-11-22 | [SK하이닉스, 기업용 QLC eSSD 출하량 역대 최대 경신](https://www.edaily.co.kr/News/Read?newsId=0192837465)
- 2026-11-22 | [한화에어로스페이스, 루마니아 보병전투장갑차 사업 최종 후보 선정](https://www.yna.co.kr/view/AKR20261122041200003)
- 2026-11-22 | [알테오젠, 글로벌 빅파마와 SC제형 기술이전 마일스톤 수령 공시](https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261122000319)`;
