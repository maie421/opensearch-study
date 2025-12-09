import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * 🎮 기본 컨트롤러
 *
 * Controller는 HTTP 요청을 받아 처리하는 역할입니다.
 * 라우팅(어떤 URL을 처리할지)을 정의합니다.
 *
 * @Controller() - 이 클래스가 컨트롤러임을 선언
 */
@Controller()
export class AppController {
  // AppService를 주입받음 (Dependency Injection)
  constructor(private readonly appService: AppService) {}

  /**
   * GET / 요청 처리
   *
   * @Get() - HTTP GET 메서드를 처리
   * 실제 URL: http://localhost:3001/api/
   * (main.ts에서 /api 프리픽스를 설정했음)
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /health 요청 처리
   *
   * 서버가 정상적으로 동작하는지 확인하는 헬스체크 엔드포인트
   * 실제 URL: http://localhost:3001/api/health
   */
  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'opensearch-backend',
    };
  }
}