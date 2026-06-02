// 색인 스크립트 공통 설정/헬퍼.
// (분석기 설정 + 매핑 + row→document 변환 + 접속 헬퍼)
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { Client } from '@opensearch-project/opensearch';

export const SOLD_OUT = 40; // product_status 품절값

// .env 직접 파싱 (호출 스크립트의 import.meta.url 을 넘김 → ../.env = backend/.env)
export function loadEnv(metaUrl) {
  const text = readFileSync(new URL('../.env', metaUrl), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// 인덱스 분석기 설정 (nori + 검색시점 동의어)
export const analysis = {
  tokenizer: {
    nori_user: { type: 'nori_tokenizer', decompound_mode: 'mixed' },
  },
  filter: {
    ko_pos: { type: 'nori_part_of_speech' },
    syn_search: {
      type: 'synonym_graph',
      synonyms_path: 'synonyms.txt',
      lenient: true,
    },
  },
  analyzer: {
    korean_index: { type: 'custom', tokenizer: 'nori_user', filter: ['ko_pos', 'lowercase'] },
    korean_search: { type: 'custom', tokenizer: 'nori_user', filter: ['ko_pos', 'lowercase', 'syn_search'] },
  },
};

// 필드 매핑
export const mappings = {
  properties: {
    market_name: {
      type: 'text',
      analyzer: 'korean_index',
      search_analyzer: 'korean_search',
      fields: { keyword: { type: 'keyword', ignore_above: 512 } },
    },
    name: { type: 'text', analyzer: 'korean_index', search_analyzer: 'korean_search' },
    price: { type: 'integer' },
    original_price: { type: 'integer' },
    thumbnail_url: { type: 'keyword', index: false },
    is_sold_out: { type: 'boolean' },
    product_status: { type: 'integer' },
  },
};

// ll_product row → OpenSearch document
export function buildDoc(r) {
  return {
    market_name: (r.market_name ?? '').trim(),
    name: (r.name ?? '').trim(),
    price: r.sell_price ?? 0,
    original_price: r.origin_price ?? 0,
    thumbnail_url: r.main_image_url ?? null,
    is_sold_out: r.product_status === SOLD_OUT,
    product_status: r.product_status,
  };
}

export function newOpenSearch() {
  return new Client({ node: process.env.OPENSEARCH_NODE ?? 'http://localhost:9200' });
}

export function newDb() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 7000,
    dateStrings: true, // DATETIME 을 'YYYY-MM-DD HH:MM:SS' 문자열로 (워터마크 비교용)
  });
}

// blue-green 인덱스 이름: products_v20260603001234
export function buildIndexName(alias) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${alias}_v${ts}`;
}
