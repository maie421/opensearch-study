// 회사 부서가 제공한 동의어 Google Sheet → docker/opensearch/synonyms.txt 자동 생성.
//
// 실행: packages/backend 에서  node scripts/sheets-to-synonyms.mjs
//
// 설계 메모:
//  - 시트는 "링크가 있는 사용자 보기 가능"으로 공유돼 있어 CSV export URL 로 무인증 fetch 한다.
//  - 시트마다 컬럼 레이아웃이 다르다(남/여, 키즈는 컬럼 +1, 라이프는 헤더 없음).
//    → 컬럼 위치에 의존하지 않고 "한 셀을 콤마로 쪼개 2개 이상이면 동의어 그룹" 으로 본다.
//    카테고리 셀은 콤마 대신 슬래시(자켓/블레이저)를 쓰므로 이 휴리스틱이 안전하다.
//  - 같은 동의어 그룹(예: 의류·자켓)이 수백 행 반복되므로 정규화 후 dedup 한다.
//  - 출력은 Solr 양방향 포맷(쉼표 나열) 한 줄 = 한 그룹.
//
// 주의: synonyms.txt 가 바뀌면 색인 시점 동의어 방식이라 전량 재색인(blue-green)이 필요하다.
//       node scripts/reindex-full.mjs all

import { writeFileSync } from 'node:fs';

const SPREADSHEET_ID = '1o-mL1Rp1srGHvTz3cCn9PaC8Imdbu6ze2tR-HbNnr_Y';

// gid → 사람이 읽을 탭 이름 (보내준 순서)
const TABS = [
  { gid: '727559581', label: '남성' },
  { gid: '1598539532', label: '여성' },
  { gid: '1220812342', label: '키즈' },
  { gid: '24540709', label: '라이프' },
];

const OUTPUT_PATH = new URL('../../../docker/opensearch/synonyms.txt', import.meta.url);

function exportUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
}

// 최소 RFC4180 CSV 파서 (따옴표 안 콤마/개행, "" 이스케이프 처리). 외부 의존성 없이.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // 이스케이프된 따옴표
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      // CRLF 의 CR 무시
    } else field += c;
  }
  // 마지막 필드/행 flush
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 한 셀 → 동의어 그룹(2개 이상의 서로 다른 항목) 또는 null
function cellToGroup(cell) {
  const terms = cell.split(',').map((t) => t.trim()).filter(Boolean);
  // 같은 표기 중복 제거(대소문자 무시), 첫 등장 표기 보존
  const seen = new Set();
  const unique = [];
  for (const t of terms) {
    const key = t.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(t); }
  }
  return unique.length >= 2 ? unique : null;
}

// 그룹 정규화 키(중복 그룹 제거용): 소문자 정렬 후 결합
function groupKey(group) {
  return group.map((t) => t.toLowerCase()).sort().join('|');
}

async function fetchCsv(gid) {
  const res = await fetch(exportUrl(gid));
  if (!res.ok) throw new Error(`gid=${gid} fetch 실패: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const groups = new Map(); // key → group(원본 표기 배열)
  const perTab = [];

  for (const { gid, label } of TABS) {
    const csv = await fetchCsv(gid);
    const rows = parseCsv(csv);
    let found = 0;
    for (const row of rows) {
      for (const cell of row) {
        const group = cellToGroup(cell);
        if (!group) continue;
        found++;
        const key = groupKey(group);
        if (!groups.has(key)) groups.set(key, group);
      }
    }
    perTab.push({ label, rows: rows.length, cells: found });
  }

  // 첫 항목 기준 정렬(안정적 diff)
  const sorted = [...groups.values()].sort((a, b) =>
    a[0].localeCompare(b[0], 'ko'),
  );

  const header = [
    '# OpenSearch 동의어 사전 (Solr 포맷) — 자동 생성 파일. 직접 수정하지 말 것.',
    `# 출처: Google Sheet ${SPREADSHEET_ID} (탭: ${TABS.map((t) => t.label).join(', ')})`,
    '# 재생성: packages/backend 에서  node scripts/sheets-to-synonyms.mjs',
    '# 반영: 색인 시점 동의어이므로 변경 시 전량 재색인 필요  →  node scripts/reindex-full.mjs all',
    '',
    '',
  ].join('\n');

  writeFileSync(OUTPUT_PATH, header + sorted.join('\n') + '\n', 'utf8');

  // 요약
  console.log('탭별 동의어 셀 수:');
  for (const t of perTab) console.log(`  ${t.label}: ${t.cells} (행 ${t.rows})`);
  const totalCells = perTab.reduce((s, t) => s + t.cells, 0);
  console.log(`총 셀 ${totalCells} → 중복 제거 후 동의어 그룹 ${sorted.length}개`);
  console.log(`생성: ${OUTPUT_PATH.pathname}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
