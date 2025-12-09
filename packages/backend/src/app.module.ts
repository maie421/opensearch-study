import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OpensearchModule } from './opensearch/opensearch.module';

/**
 * 📦 루트 모듈
 *
 * NestJS는 모듈 기반 아키텍처입니다.
 * 모든 기능은 모듈로 나뉘고, 이 AppModule이 전체를 총괄합니다.
 *
 * @Module 데코레이터:
 * - imports: 다른 모듈을 가져옴 (여기서는 OpensearchModule)
 * - controllers: HTTP 요청을 처리할 컨트롤러들
 * - providers: 비즈니스 로직을 담당할 서비스들
 */
@Module({
  imports: [
    OpensearchModule, // OpenSearch 관련 기능을 담당하는 모듈
  ],
  controllers: [AppController], // 헬스체크용 컨트롤러
  providers: [AppService],       // 기본 서비스
})
export class AppModule {}