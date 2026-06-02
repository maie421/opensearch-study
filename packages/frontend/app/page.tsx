'use client';

import { useState } from 'react';

/**
 * 🛍️ 상품 유사도 검색 페이지
 *
 * 백엔드(/api/products/search)를 호출해서 market_name 유사도순으로
 * 상품을 카드 그리드로 보여준다.
 */

const API = 'http://localhost:3001/api/products/search';

interface Product {
  id: string;
  score: number;
  market_name: string;
  name: string;
  price: number;
  original_price: number;
  thumbnail_url: string | null;
  is_sold_out: boolean;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [includeSoldOut, setIncludeSoldOut] = useState(false);
  const [items, setItems] = useState<Product[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setError('검색어를 입력하세요');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        q: query,
        size: '24',
        includeSoldOut: String(includeSoldOut),
      });
      const res = await fetch(`${API}?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
        setTotal(data.total);
      } else {
        setError(data.error || '검색 실패');
        setItems([]);
      }
    } catch {
      setError('서버 연결 실패. 백엔드(3001)가 실행 중인지 확인하세요.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const won = (n: number) => '₩' + (n ?? 0).toLocaleString();
  const discount = (p: Product) =>
    p.original_price > p.price
      ? Math.round(((p.original_price - p.price) / p.original_price) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-white text-gray-900 px-4 py-10">
      <div className="max-w-6xl mx-auto">
        {/* 헤더 */}
        <h1 className="text-3xl font-bold mb-1">🛍️ 상품 유사도 검색</h1>
        <p className="text-sm text-gray-500 mb-6">
          OpenSearch · market_name 기준 유사도순 노출
        </p>

        {/* 검색 폼 */}
        <form onSubmit={search} className="flex flex-wrap items-center gap-3 mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 가방, 반팔 티셔츠, 패딩"
            className="flex-1 min-w-[240px] px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 rounded-lg bg-black text-white font-semibold disabled:bg-gray-400"
          >
            {loading ? '검색 중…' : '검색'}
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSoldOut}
              onChange={(e) => setIncludeSoldOut(e.target.checked)}
              className="w-4 h-4"
            />
            품절 포함 (뒤로 정렬)
          </label>
        </form>

        {/* 에러 */}
        {error && (
          <div className="border-l-4 border-red-500 bg-red-50 text-red-700 p-3 mb-6 rounded">
            ❌ {error}
          </div>
        )}

        {/* 결과 개수 */}
        {items && !error && (
          <p className="text-sm text-gray-500 mb-4">
            총 <b className="text-black">{total.toLocaleString()}</b>건
          </p>
        )}

        {/* 카드 그리드 */}
        {items && items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-8">
            {items.map((p) => (
              <div key={p.id} className="group">
                {/* 썸네일 */}
                <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden mb-2">
                  {p.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbnail_url}
                      alt={p.market_name}
                      className={`w-full h-full object-cover ${
                        p.is_sold_out ? 'opacity-50 grayscale' : ''
                      }`}
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-gray-300 text-xs">
                      No Image
                    </div>
                  )}
                  {p.is_sold_out && (
                    <span className="absolute top-2 left-2 bg-black/70 text-white text-[11px] px-2 py-0.5 rounded">
                      품절
                    </span>
                  )}
                  {/* 유사도 점수 (학습용 표시) */}
                  <span className="absolute bottom-2 right-2 bg-white/80 text-gray-700 text-[10px] px-1.5 py-0.5 rounded">
                    score {p.score?.toFixed(1)}
                  </span>
                </div>

                {/* 상품명 */}
                <p className="text-xs text-gray-700 leading-snug line-clamp-2 mb-1 min-h-[2.2em]">
                  {p.market_name}
                </p>

                {/* 가격 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold">{won(p.price)}</span>
                  {discount(p) > 0 && (
                    <>
                      <span className="text-xs text-gray-400 line-through">
                        {won(p.original_price)}
                      </span>
                      <span className="text-xs font-semibold text-red-500">
                        {discount(p)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 결과 없음 */}
        {items && items.length === 0 && !error && (
          <p className="text-center text-gray-400 py-16">검색 결과가 없습니다</p>
        )}
      </div>
    </div>
  );
}
