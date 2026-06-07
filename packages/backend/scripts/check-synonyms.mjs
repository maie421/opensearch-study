// 동의어 사전(synonyms.txt) 도달성 점검.
//
// "색인 시점 동의어"라, 사전에 적은 표기라도 nori 품사/정규화에서 떨어져 나가면
// 실제로는 매칭에 안 쓰인다(예: 오타 변형 '자캣'이 색인 토큰에서 유실).
//
// 판정 기준(실제 검색 동작과 동일한 관점):
//   - 그룹의 "hub" = 멤버 중 korean_index 로 가장 많이 펼쳐지는 항목(실제로 동의어가
//     터지는 기준점). 대표어(첫 항목)가 nori 에 분해돼 안 터지는 경우가 많아 hub 로 잡는다.
//   - 색인측: analyze(hub,  korean_index)  → 그 그룹 문서가 색인될 때 갖는 토큰들
//   - 검색측: analyze(멤버, korean_search) → 사용자가 그 멤버로 검색할 때의 토큰들
//   - 멤버가 "도달 가능" = 검색측 토큰이 모두 hub 의 색인 토큰에 포함됨
//     (즉, hub 로 색인된 그 그룹 상품을 그 멤버로 검색하면 실제로 잡힌다)
//
// 실행: cd packages/backend && node scripts/check-synonyms.mjs [--limit N]
// 전제: OpenSearch(:9200)와 'products' 별칭(분석기 포함)이 떠 있어야 함.

import { readFileSync } from 'node:fs';
import { loadEnv, newOpenSearch } from './lib/index-config.mjs';

loadEnv(import.meta.url);

const INDEX = process.env.PRODUCTS_INDEX ?? 'products';
const SYN_PATH = new URL('../../../docker/opensearch/synonyms.txt', import.meta.url);
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const os = newOpenSearch();

// synonyms.txt → 그룹 배열. 양방향(콤마) 한 줄 = 한 그룹.
// 일방향(a => b)도 지원: 좌변 멤버들이 우변으로만 가야 하므로 전체를 한 그룹으로 합쳐 점검.
function parseGroups(text) {
  const groups = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sides = line.includes('=>') ? line.split('=>') : [line];
    const members = sides
      .join(',')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (members.length >= 2) groups.push(members);
  }
  return groups;
}

// analyze 캐시 (analyzer|text → 소문자 토큰 배열). 멤버 표기가 그룹 간 많이 겹쳐 호출 절감.
const cache = new Map();
async function analyze(analyzer, text) {
  const key = `${analyzer}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const res = await os.indices.analyze({ index: INDEX, body: { analyzer, text } });
  const tokens = res.body.tokens.map((t) => t.token.toLowerCase());
  cache.set(key, tokens);
  return tokens;
}

const groups = parseGroups(readFileSync(SYN_PATH, 'utf8'));
const target = groups.slice(0, LIMIT);
console.log(`동의어 그룹 ${groups.length}개 중 ${target.length}개 점검 (index=${INDEX})...\n`);

const problems = []; // { hub, missing:[멤버...], deadHub:bool }
let memberTotal = 0, memberMiss = 0;

for (let gi = 0; gi < target.length; gi++) {
  const group = target[gi];

  // 1) 각 멤버의 색인 펼침을 구해 hub(가장 많이 펼쳐지는 멤버) 선정
  let hub = group[0], hubTokens = [];
  for (const member of group) {
    const idx = await analyze('korean_index', member);
    if (idx.length > hubTokens.length) { hub = member; hubTokens = idx; }
  }
  const hubSet = new Set(hubTokens);

  // 2) hub 외 멤버들이 hub 의 색인 토큰으로 도달 가능한지
  const missing = [];
  for (const member of group) {
    if (member === hub) continue;
    memberTotal++;
    const searchTokens = await analyze('korean_search', member);
    const reachable =
      searchTokens.length > 0 && searchTokens.every((t) => hubSet.has(t));
    if (!reachable) { missing.push(member); memberMiss++; }
  }
  // hub 자체가 동의어를 못 펼치면(=그룹 크기만큼도 안 나옴) 그룹 전체가 죽은 것
  const deadHub = hubTokens.length <= 2;
  if (missing.length || deadHub) problems.push({ hub, missing, deadHub });

  if ((gi + 1) % 25 === 0) process.stdout.write(`\r  ${gi + 1}/${target.length} 그룹...`);
}
process.stdout.write('\r' + ' '.repeat(40) + '\r');

// ── 출력 ──
if (problems.length) {
  console.log(`⚠️  문제 그룹 ${problems.length}개 (기준 hub 로도 도달 안 되는 멤버가 있음):\n`);
  for (const p of problems.slice(0, 40)) {
    const tag = p.deadHub ? '💀그룹전체죽음 ' : '';
    console.log(`  ${tag}[hub:${p.hub}] → 유실(${p.missing.length}): ${p.missing.slice(0, 12).join(', ')}${p.missing.length > 12 ? ' …' : ''}`);
  }
  if (problems.length > 40) console.log(`  ... 외 ${problems.length - 40}개 그룹`);
} else {
  console.log('✅ 모든 동의어가 hub 색인 토큰으로 도달 가능합니다.');
}

// 단일어 vs 다중어(공백 포함) 유실 분리 — 단일어 유실이 우선 손볼 대상
const allMissing = problems.flatMap((p) => p.missing);
const singleMiss = allMissing.filter((m) => !m.includes(' '));
const multiMiss = allMissing.filter((m) => m.includes(' '));

console.log(`\n${'─'.repeat(50)}`);
console.log(`멤버 ${memberTotal}개 중 유실 ${memberMiss}개 / 문제 그룹 ${problems.length}개`);
console.log(`  · 단일어 유실 ${singleMiss.length}개  ← 우선 수정 대상 (nori 분해/오타 변형 등)`);
console.log(`  · 다중어 유실 ${multiMiss.length}개  ← 색인시점 동의어의 구조적 한계(조합어)`);
console.log(`(analyze 호출 ${cache.size}회 — 캐시 적용)`);
