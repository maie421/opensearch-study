import { Module } from '@nestjs/common';
import { OpensearchService } from './opensearch.service';
import { OpensearchController } from './opensearch.controller';

/**
 * 🔍 OpenSearch 모듈
 *
 * OpenSearch 관련 기능을 모아둔 모듈입니다.
 * - Controller: /search 같은 검색 API 엔드포인트 제공
 * - Service: 실제로 OpenSearch 서버와 통신
 */
@Module({
  controllers: [OpensearchController],
  providers: [OpensearchService],
  exports: [OpensearchService], // 다른 모듈에서도 사용 가능하게
})
export class OpensearchModule {}