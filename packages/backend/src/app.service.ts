import { Injectable } from '@nestjs/common';

/**
 * ⚙️ 기본 서비스
 *
 * Service는 실제 비즈니스 로직을 처리합니다.
 * Controller가 Service를 호출해서 데이터를 가져옵니다.
 *
 * @Injectable() - 이 클래스가 다른 곳에 주입될 수 있음을 표시
 * (Dependency Injection 가능)
 */
@Injectable()
export class AppService {
  getHello(): string {
    return 'OpenSearch Study Backend - NestJS is running! 🚀';
  }
}