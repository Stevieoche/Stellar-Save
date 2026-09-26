import { AnalyticsService } from '../../analytics_service';
import { logger } from '../../logger';
import { prisma } from '../../prisma_client';

export class AnalyticsHandler {
  private analyticsService: AnalyticsService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma client injected at runtime; generated types not importable here
  constructor(dbClient: any = prisma) {
    this.analyticsService = new AnalyticsService(dbClient);
  }

  async execute(lookbackHours: number = 25): Promise<{ scanned: number; indexed: number; skipped: number }> {
    try {
      const result = await this.analyticsService.resyncSorobanAnalytics({ lookbackHours });
      logger.info('Analytics resync completed', result);
      return result;
    } catch (error) {
      logger.error('Analytics resync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
