// updated_at 워터마크 증분 색인.
//  - 마지막 워터마크 이후 바뀐 상품만 골라서 그 _id 만 upsert
//  - 삭제(deleted_at 채워짐)된 상품은 인덱스에서 delete
//  - 끝나면 워터마크를 이번 실행 시작 시각(DB 시계)으로 갱신
//
// 검색 별칭('products')에 직접 쓰므로, blue-green swap 후에도 최신 인덱스로 반영됨.
//
// 실행: cd packages/backend && node scripts/reindex-incremental.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEnv, buildDoc, newOpenSearch, newDb } from './lib/index-config.mjs';

loadEnv(import.meta.url);

const ALIAS = process.env.PRODUCTS_INDEX ?? 'products';
const WATERMARK_PATH = new URL('./.watermark.json', import.meta.url);

const os = newOpenSearch();
const db = await newDb();

// ── 워터마크 읽기 (없으면 아주 과거부터) ──
let since = '1970-01-01 00:00:00';
if (existsSync(WATERMARK_PATH)) {
  since = JSON.parse(readFileSync(WATERMARK_PATH, 'utf8')).watermark ?? since;
}

// 이번 실행의 새 워터마크 = 지금 DB 시각 (다음 실행이 여기서 이어받음)
const [[{ db_now }]] = await db.query('SELECT NOW() AS db_now');

console.log(`[증분] 워터마크 이후 변경분 조회: updated_at >= '${since}'`);

// ── 변경분 조회 (삭제 포함) ──
const [rows] = await db.query(
  `SELECT seq, market_name, name, sell_price, origin_price, main_image_url,
          product_status, deleted_at, updated_at
   FROM ll_product
   WHERE updated_at >= ?
   ORDER BY updated_at, seq`,
  [since],
);

if (rows.length === 0) {
  console.log('변경된 상품 없음. 워터마크만 갱신.');
} else {
  const body = [];
  let up = 0, del = 0;
  for (const r of rows) {
    if (r.deleted_at) {
      // 삭제된 상품 → 인덱스에서 제거
      body.push({ delete: { _index: ALIAS, _id: String(r.seq) } });
      del++;
    } else if ((r.market_name ?? '').trim()) {
      // 변경된 상품 → 그 _id 만 덮어쓰기(upsert)
      body.push({ index: { _index: ALIAS, _id: String(r.seq) } });
      body.push(buildDoc(r));
      up++;
    }
  }

  // 증분은 소량이라 바로 검색 반영(refresh: true)
  const res = await os.bulk({ body, refresh: true });
  const idxErr = res.body.items.find((it) => it.index?.error)?.index?.error;
  if (idxErr) console.error('⚠️ index 에러:', idxErr);

  console.log(`변경 ${rows.length}건 처리: upsert ${up}, delete ${del}`);
}

// ── 워터마크 갱신 ──
writeFileSync(
  WATERMARK_PATH,
  JSON.stringify({ watermark: db_now, source: 'reindex-incremental' }, null, 2),
);
console.log(`✅ 증분 완료. 새 워터마크: ${db_now}`);

await db.end();
