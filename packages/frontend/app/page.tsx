'use client';

import { useState, useEffect } from 'react';

/**
 * 🔍 OpenSearch 검색 페이지 (개선 버전)
 *
 * 기능:
 * - 통계 대시보드
 * - 기본 검색 / 고급 검색 (탭 UI)
 * - 개선된 검색 결과 표시
 */
export default function Home() {
  // ============================================
  // 📊 통계 상태
  // ============================================
  const [statistics, setStatistics] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // ============================================
  // 🔍 검색 상태
  // ============================================
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');

  // 기본 검색
  const [query, setQuery] = useState('');

  // 고급 검색 필터
  const [category, setCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minRating, setMinRating] = useState('');
  const [excludeCategory, setExcludeCategory] = useState('');

  // 공통
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ============================================
  // 📊 통계 불러오기 (페이지 로드 시)
  // ============================================
  useEffect(() => {
    fetchStatistics();
  }, []);

  const fetchStatistics = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/opensearch/books/statistics');
      const data = await response.json();

      if (data.success) {
        setStatistics(data.statistics);
      }
    } catch (err) {
      console.error('통계 로드 실패:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // ============================================
  // 🔍 기본 검색
  // ============================================
  const handleBasicSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!query.trim()) {
      setError('검색어를 입력하세요');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);

    try {
      const response = await fetch(
        `http://localhost:3001/api/opensearch/search?index=books&q=${encodeURIComponent(query)}`
      );
      const data = await response.json();

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || '검색 실패');
      }
    } catch (err) {
      setError('서버 연결 실패. 백엔드가 실행 중인지 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 🔍 고급 검색
  // ============================================
  const handleAdvancedSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError('');
    setResults(null);

    try {
      const params = new URLSearchParams();
      if (category) params.append('category', category);
      if (minPrice) params.append('minPrice', minPrice);
      if (maxPrice) params.append('maxPrice', maxPrice);
      if (minRating) params.append('minRating', minRating);
      if (excludeCategory) params.append('excludeCategory', excludeCategory);

      const response = await fetch(
        `http://localhost:3001/api/opensearch/books/search/advanced?${params.toString()}`
      );
      const data = await response.json();

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || '검색 실패');
      }
    } catch (err) {
      setError('서버 연결 실패. 백엔드가 실행 중인지 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 🎨 UI 렌더링
  // ============================================
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* ============================================ */}
        {/* 헤더 */}
        {/* ============================================ */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-3">
            📚 OpenSearch Book Store
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            고급 검색 쿼리 학습 프로젝트
          </p>
        </div>

        {/* ============================================ */}
        {/* 📊 통계 대시보드 */}
        {/* ============================================ */}
        {statsLoading ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 mb-8">
            <p className="text-center text-gray-500">통계 로딩 중...</p>
          </div>
        ) : statistics ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              📊 책 데이터 통계
            </h2>

            {/* 카테고리별 통계 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {statistics.categories?.map((cat: any) => (
                <div
                  key={cat.key}
                  className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-700 dark:to-gray-600 rounded-lg p-6 border border-blue-200 dark:border-gray-500"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      {cat.key === 'fantasy' ? '🧙 Fantasy' : '💻 Programming'}
                    </h3>
                    <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                      {cat.doc_count}권
                    </span>
                  </div>
                  <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                    <p>
                      📈 평균 가격: <span className="font-semibold">{Math.round(cat.avg_price.value).toLocaleString()}원</span>
                    </p>
                    <p>
                      ⭐ 평균 평점: <span className="font-semibold">{cat.avg_rating.value.toFixed(2)}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* 전체 통계 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">총 책 수</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {statistics.priceStats.count}권
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">평균 가격</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {Math.round(statistics.priceStats.avg).toLocaleString()}원
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">가격 범위</p>
                <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                  {Math.round(statistics.priceStats.min).toLocaleString()} ~ {Math.round(statistics.priceStats.max).toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">평균 평점</p>
                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  ⭐ {statistics.ratingStats.avg.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* ============================================ */}
        {/* 🔍 검색 탭 */}
        {/* ============================================ */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden mb-8">
          {/* 탭 헤더 */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab('basic')}
              className={`flex-1 py-4 px-6 font-semibold transition-colors ${
                activeTab === 'basic'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              🔍 기본 검색
            </button>
            <button
              onClick={() => setActiveTab('advanced')}
              className={`flex-1 py-4 px-6 font-semibold transition-colors ${
                activeTab === 'advanced'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              ⚙️ 고급 검색
            </button>
          </div>

          {/* 탭 콘텐츠 */}
          <div className="p-8">
            {/* ============================================ */}
            {/* 기본 검색 폼 */}
            {/* ============================================ */}
            {activeTab === 'basic' && (
              <form onSubmit={handleBasicSearch} className="space-y-6">
                <div>
                  <label htmlFor="query" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    검색어 (제목에서 검색)
                  </label>
                  <input
                    id="query"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="예: 마법, 코드, 타입스크립트"
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    💡 Wildcard 쿼리를 사용하여 제목 필드에서 부분 일치 검색합니다
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
                >
                  {loading ? '검색 중...' : '🔍 검색'}
                </button>
              </form>
            )}

            {/* ============================================ */}
            {/* 고급 검색 폼 */}
            {/* ============================================ */}
            {activeTab === 'advanced' && (
              <form onSubmit={handleAdvancedSearch} className="space-y-6">
                {/* 카테고리 선택 */}
                <div>
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    카테고리 (Term 쿼리)
                  </label>
                  <select
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">전체</option>
                    <option value="fantasy">Fantasy</option>
                    <option value="programming">Programming</option>
                  </select>
                </div>

                {/* 가격 범위 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="minPrice" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      최소 가격 (Range 쿼리)
                    </label>
                    <input
                      id="minPrice"
                      type="number"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      placeholder="예: 10000"
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label htmlFor="maxPrice" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      최대 가격
                    </label>
                    <input
                      id="maxPrice"
                      type="number"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      placeholder="예: 30000"
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* 평점 필터 */}
                <div>
                  <label htmlFor="minRating" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    최소 평점 (Range 쿼리)
                  </label>
                  <input
                    id="minRating"
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    value={minRating}
                    onChange={(e) => setMinRating(e.target.value)}
                    placeholder="예: 4.5"
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* 제외할 카테고리 */}
                <div>
                  <label htmlFor="excludeCategory" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    제외할 카테고리 (Bool must_not)
                  </label>
                  <select
                    id="excludeCategory"
                    value={excludeCategory}
                    onChange={(e) => setExcludeCategory(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">없음</option>
                    <option value="fantasy">Fantasy 제외</option>
                    <option value="programming">Programming 제외</option>
                  </select>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    💡 <span className="font-semibold">Bool 쿼리 사용:</span> 여러 조건을 조합하여 검색합니다 (must, filter, must_not)
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
                >
                  {loading ? '검색 중...' : '⚙️ 고급 검색'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* ============================================ */}
        {/* 에러 메시지 */}
        {/* ============================================ */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 mb-8 rounded">
            <p className="text-red-700 dark:text-red-300 font-medium">❌ {error}</p>
          </div>
        )}

        {/* ============================================ */}
        {/* 검색 결과 */}
        {/* ============================================ */}
        {results && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">검색 결과</h2>
              <p className="text-gray-600 dark:text-gray-400">
                총 <span className="font-semibold text-blue-600">{results.total}</span>개 발견
              </p>
            </div>

            {/* 결과 목록 */}
            {results.hits && results.hits.length > 0 ? (
              <div className="space-y-4">
                {results.hits.map((hit: any) => {
                  const book = hit._source;
                  return (
                    <div
                      key={hit._id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 hover:shadow-lg transition-shadow bg-gradient-to-r from-white to-gray-50 dark:from-gray-800 dark:to-gray-750"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                            {book.title}
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            저자: {book.author}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded">
                            Score: {hit._score.toFixed(2)}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            book.category === 'fantasy'
                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                              : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          }`}>
                            {book.category}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{book.description}</p>

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">💰</span>
                          <span className="font-semibold text-green-600 dark:text-green-400">
                            {book.price?.toLocaleString()}원
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">⭐</span>
                          <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                            {book.rating}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">📅</span>
                          <span className="text-gray-600 dark:text-gray-400">{book.published_date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-gray-400">📚</span>
                          <span className="text-xs text-gray-500 dark:text-gray-500">{book.isbn}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-gray-500 dark:text-gray-400 py-8">검색 결과가 없습니다</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}