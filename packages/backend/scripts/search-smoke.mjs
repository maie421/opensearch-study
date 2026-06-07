// 검색 품질 스모크/회귀 테스트.
// golden-queries.json 의 검색어를 실제 백엔드 API(/api/products/search)로 때려
//  - expect: 상위 결과에 '있으면 좋은' 부분문자열 (소프트 — 없으면 ⚠️ 경고)
//  - forbid: 상위 결과에 '있으면 안 되는' 부분문자열 (하드 — 있으면 ❌ 실패)
// 하드 실패가 하나라도 있으면 exit 1 (CI/회귀 감시용).
//
// 실행: cd packages/backend && node scripts/search-smoke.mjs
// 전제: 백엔드(:3001)와 색인된 'products' 별칭이 떠 있어야 함.
// 환경변수 API_BASE 로 베이스 URL override 가능 (기본 http://localhost:3001/api).

import { readFileSync } from 'node:fs';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const GOLDEN_PATH = new URL('./golden-queries.json', import.meta.url);

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
const cases = golden.cases ?? [];

function haystack(item) {
  return `${item.market_name ?? ''} ${item.name ?? ''}`;
}

async function runCase(c) {
  const size = c.size ?? 10;
  const includeSoldOut = c.includeSoldOut ?? true;
  const url = `${API_BASE}/products/search?q=${encodeURIComponent(c.q)}`
    + `&size=${size}&includeSoldOut=${includeSoldOut}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status} for q=${c.q}`);
  const data = await res.json();
  const items = data.items ?? [];
  const texts = items.map(haystack);

  // expect: 각 부분문자열이 상위 결과 어딘가에 나오는지
  const expectMiss = (c.expect ?? []).filter(
    (sub) => !texts.some((t) => t.includes(sub)),
  );
  // forbid: 나오면 안 되는데 나온 것 (어느 항목에서 걸렸는지도 기록)
  const forbidHit = (c.forbid ?? [])
    .map((sub) => ({ sub, where: items.find((it) => haystack(it).includes(sub)) }))
    .filter((x) => x.where);

  return { c, total: data.total ?? 0, items, expectMiss, forbidHit };
}

const results = [];
for (const c of cases) results.push(await runCase(c));

// ── 출력 ──
let hardFail = 0;
for (const r of results) {
  const ok = r.forbidHit.length === 0;
  if (!ok) hardFail++;
  const mark = !ok ? '❌' : r.expectMiss.length ? '⚠️ ' : '✅';
  console.log(`\n${mark} q="${r.c.q}"  (total=${r.total}, 상위 ${r.items.length}건 검사)`);

  if (r.forbidHit.length) {
    for (const f of r.forbidHit) {
      console.log(`   ❌ 금지어 '${f.sub}' 노출: "${f.where.market_name}"`);
    }
  }
  if (r.expectMiss.length) {
    console.log(`   ⚠️  기대어 미노출: ${r.expectMiss.map((s) => `'${s}'`).join(', ')}`);
  }
  if (ok && !r.expectMiss.length && r.items[0]) {
    console.log(`   ▶ 1위: "${r.items[0].market_name}" (score ${r.items[0].score?.toFixed?.(2)})`);
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`케이스 ${results.length}개 / 하드 실패(금지어 노출) ${hardFail}개`);
process.exit(hardFail ? 1 : 0);
