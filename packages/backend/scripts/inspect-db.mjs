// ll_product 구조/데이터를 한 번에 확인하는 점검 스크립트
// 실행: cd packages/backend && node scripts/inspect-db.mjs
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

// .env 간단 파싱 (pnpm 격리 구조라 dotenv 직접 참조가 안 돼서 직접 읽음)
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 7000,
});

console.log('✅ DB 연결 성공\n');

// 1) 컬럼 구조
const [cols] = await conn.query('SHOW FULL COLUMNS FROM ll_product');
console.log('== ll_product 컬럼 ==');
for (const c of cols) {
  console.log(`- ${c.Field} (${c.Type})${c.Comment ? '  // ' + c.Comment : ''}`);
}

// 2) 전체 건수
const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM ll_product');
console.log(`\n== 전체 상품 수: ${cnt.toLocaleString()} ==`);

// 3) product_status 분포 (품절=40 확인)
const [statusDist] = await conn.query(
  'SELECT product_status, COUNT(*) AS cnt FROM ll_product GROUP BY product_status ORDER BY cnt DESC',
);
console.log('\n== product_status 분포 ==');
for (const r of statusDist) console.log(`- status ${r.product_status}: ${r.cnt.toLocaleString()}`);

// 4) 샘플 3건 (우리가 색인할 컬럼)
const [sample] = await conn.query(
  `SELECT seq, market_name, name, sell_price, origin_price, main_image_url, product_status
   FROM ll_product WHERE market_name IS NOT NULL AND market_name <> '' LIMIT 3`,
);
console.log('\n== 샘플 (색인 대상 컬럼) ==');
console.log(JSON.stringify(sample, null, 2));

await conn.end();
