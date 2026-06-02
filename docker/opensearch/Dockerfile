# OpenSearch 공식 이미지 + 한글 형태소 분석기(nori) 플러그인
# nori 가 있어야 "삼성갤럭시버즈" 같은 상품명을 의미 단위(삼성/갤럭시/버즈)로 쪼개서
# 유사도 검색이 제대로 동작한다.
FROM opensearchproject/opensearch:2.13.0

# analysis-nori 플러그인 설치 (이미지와 동일한 버전이 자동 설치됨)
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-nori