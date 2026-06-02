// blue-green 전량 재색인.
//  1. 새 인덱스 products_v<ts> 생성 (적재용 설정: refresh off, replica 0)
//  2. ll_product 전량을 keyset 스트리밍으로 bulk 색인 (refresh:false)
//  3. refresh 한 번 + 설정 원복
//  4. alias 'products' 를 새 인덱스로 atomic swap (검색 무중단)
//  5. 옛 인덱스 정리 (직전 1개 보존) + 워터마크 저장
//
// 실행: cd packages/backend && node scripts/reindex-full.mjs [건수|all]
//   예) node scripts/reindex-full.mjs 5000   (기본 5000)
//       node scripts/reindex-full.mjs all    (전체)
import { writeFileSync } from 'node:fs';
import {
  loadEnv, analysis, mappings, buildDoc,
  newOpenSearch, newDb, buildIndexName,
} from './lib/index-config.mjs';

loadEnv(import.meta.url);

const ALIAS = process.env.PRODUCTS_INDEX ?? 'products';
const arg = process.argv[2] ?? '5000';
const LIMIT = arg === 'all' || arg === '0' ? Infinity : Number(arg);
const BATCH = 2000;
const KEEP = 2; // 보존 세대 (현재 + 직전 1개)
const WATERMARK_PATH = new URL('./.watermark.json', import.meta.url);

const os = newOpenSearch();
const db = await newDb();
const newIndex = buildIndexName(ALIAS);

// 재색인 시작 시각(=DB 시계)을 워터마크로 — 이후 변경분을 증분이 따라잡게 함
const [[{ db_now }]] = await db.query('SELECT NOW() AS db_now');

console.log(`[blue-green] 새 인덱스 = ${newIndex}`);

// ── ALIAS 이름이 "구체 인덱스"로 남아있으면 삭제 (별칭으로 전환) ──
const isAlias = (await os.indices.existsAlias({ name: ALIAS })).body;
const nameExists = (await os.indices.exists({ index: ALIAS })).body;
if (nameExists && !isAlias) {
  console.log(`기존 구체 인덱스 '${ALIAS}' 삭제 → 별칭으로 전환`);
  await os.indices.delete({ index: ALIAS });
}

// ── 1. 새 인덱스 생성 (적재 최적화 설정) ──
await os.indices.create({
  index: newIndex,
  body: {
    settings: {
      index: {
        refresh_interval: '-1',   // 적재 중 refresh 끔 (가장 큰 속도 이득)
        number_of_replicas: 0,    // 로컬은 단일노드라 0. 운영은 적재 중 0 → 끝나고 1로 원복
        analysis,
      },
    },
    mappings,
  },
});
console.log('인덱스 생성 완료. 색인 시작...');

// ── 2. keyset 스트리밍 bulk 색인 ──
let lastSeq = 0, processed = 0, soldOut = 0;
while (processed < LIMIT) {
  const lim = Math.min(BATCH, LIMIT - processed);
  const [rows] = await db.query(
    `SELECT seq, market_name, name, sell_price, origin_price, main_image_url, product_status
     FROM ll_product
     WHERE deleted_at IS NULL AND market_name IS NOT NULL AND market_name <> '' AND seq > ?
     ORDER BY seq LIMIT ?`,
    [lastSeq, lim],
  );
  if (rows.length === 0) break;

  const body = [];
  for (const r of rows) {
    const doc = buildDoc(r);
    if (doc.is_sold_out) soldOut++;
    body.push({ index: { _index: newIndex, _id: String(r.seq) } });
    body.push(doc);
  }
  const res = await os.bulk({ body, refresh: false });
  if (res.body.errors) {
    const err = res.body.items.find((it) => it.index?.error)?.index?.error;
    console.error('⚠️ bulk 에러:', err);
  }
  processed += rows.length;
  lastSeq = rows[rows.length - 1].seq;
  process.stdout.write(`\r  ${processed} 색인...`);
}
console.log();

// ── 3. 설정 원복 + refresh ──
await os.indices.putSettings({
  index: newIndex,
  body: { index: { refresh_interval: '1s' } }, // 운영이라면 number_of_replicas: 1 도 함께
});
await os.indices.refresh({ index: newIndex });
const { body: cnt } = await os.count({ index: newIndex });
console.log(`색인 완료: ${processed}건 (품절 ${soldOut}) / 인덱스 문서수 ${cnt.count}`);

// ── 4. alias atomic swap ──
const actions = [{ add: { index: newIndex, alias: ALIAS } }];
let oldIndexes = [];
try {
  const aliasRes = await os.indices.getAlias({ name: ALIAS });
  oldIndexes = Object.keys(aliasRes.body).filter((i) => i !== newIndex);
} catch (e) {
  if (e.statusCode !== 404) throw e; // 첫 swap 이면 alias 없음(404)
}
for (const old of oldIndexes) actions.unshift({ remove: { index: old, alias: ALIAS } });
await os.indices.updateAliases({ body: { actions } });
console.log(`별칭 전환: '${ALIAS}' → ${newIndex}` + (oldIndexes.length ? ` (이전: ${oldIndexes.join(', ')} 분리)` : ''));

// ── 5. 옛 인덱스 정리 (직전 1개 보존) ──
const cat = await os.cat.indices({ index: `${ALIAS}_v*`, format: 'json' });
const allVersions = cat.body.map((r) => r.index).sort().reverse(); // 최신 먼저
for (const idx of allVersions.slice(KEEP)) {
  await os.indices.delete({ index: idx });
  console.log('옛 인덱스 삭제:', idx);
}

// ── 워터마크 저장 (증분이 이어받음) ──
writeFileSync(
  WATERMARK_PATH,
  JSON.stringify({ watermark: db_now, source: 'reindex-full', at: newIndex }, null, 2),
);
console.log(`워터마크 저장: ${db_now}`);

await db.end();
console.log('✅ blue-green 재색인 완료');
