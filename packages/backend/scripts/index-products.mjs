// ll_product → OpenSearch 'products' 인덱스로 색인(bulk).
// is_sold_out = (product_status === 40) 으로 계산해서 함께 넣는다.
// _id = seq 라서 재실행해도 중복 없이 덮어쓴다(idempotent).
//
// 실행: cd packages/backend && node scripts/index-products.mjs [건수]
//   예) node scripts/index-products.mjs 5000   (기본 5000)
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { Client } from '@opensearch-project/opensearch';

// .env 직접 파싱
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const INDEX = process.env.PRODUCTS_INDEX ?? 'products';
const LIMIT = Number(process.argv[2] ?? 5000);
const BATCH = 1000; // bulk 한 번에 보낼 건수
const SOLD_OUT = 40; // ProductStatusEnum.SOLD_OUT

const os = new Client({ node: process.env.OPENSEARCH_NODE ?? 'http://localhost:9200' });
const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 7000,
});

// 색인 대상: 상품명 있고, 삭제 안 된 것
const [rows] = await db.query(
  `SELECT seq, market_name, name, sell_price, origin_price, main_image_url, product_status
   FROM ll_product
   WHERE deleted_at IS NULL AND market_name IS NOT NULL AND market_name <> ''
   ORDER BY seq
   LIMIT ?`,
  [LIMIT],
);
console.log(`DB에서 ${rows.length}건 조회됨. 색인 시작...`);

let indexed = 0;
let soldOut = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const body = [];
  for (const r of chunk) {
    const isSoldOut = r.product_status === SOLD_OUT;
    if (isSoldOut) soldOut++;
    body.push({ index: { _index: INDEX, _id: String(r.seq) } });
    body.push({
      market_name: (r.market_name ?? '').trim(),
      name: (r.name ?? '').trim(),
      price: r.sell_price ?? 0,
      original_price: r.origin_price ?? 0,
      thumbnail_url: r.main_image_url ?? null,
      is_sold_out: isSoldOut,
      product_status: r.product_status,
    });
  }
  const res = await os.bulk({ body });
  if (res.body.errors) {
    const firstErr = res.body.items.find((it) => it.index?.error)?.index?.error;
    console.error('⚠️ bulk 에러 일부 발생:', firstErr);
  }
  indexed += chunk.length;
  process.stdout.write(`\r  ${indexed}/${rows.length} 색인...`);
}

// 검색 가능하도록 refresh (방금 넣은 문서를 즉시 검색되게)
await os.indices.refresh({ index: INDEX });
const { body: countRes } = await os.count({ index: INDEX });

console.log(`\n✅ 색인 완료: ${indexed}건`);
console.log(`   - 품절(is_sold_out=true): ${soldOut}건`);
console.log(`   - 판매중 등(false): ${indexed - soldOut}건`);
console.log(`   - 인덱스 총 문서 수: ${countRes.count}건`);

await db.end();
