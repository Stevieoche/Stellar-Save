import { Router } from 'express';

import { jwtAuthMiddleware } from '../auth_middleware';
import { AppError } from '../lib/errors';
import { logger } from '../logger';
import { getQuote, sendPayment, getPaymentStatus } from '../services/sep31';

import type { AuthenticatedRequest } from '../auth_middleware';
import type { Response, NextFunction } from 'express';

/** Narrow an unknown catch value to a message string. */
function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSep31Router(): Router {
  const router = Router();

  // GET /api/sep31/quote?anchorDomain=&sendAsset=&receiveAsset=&amount=
  router.get(
    '/quote',
    jwtAuthMiddleware,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const { anchorDomain, sendAsset, receiveAsset, amount } = req.query as Record<string, string>;
      if (!anchorDomain || !sendAsset || !receiveAsset || !amount) {
        return next(
          new AppError(
            'MISSING_FIELDS',
            'anchorDomain, sendAsset, receiveAsset, amount are required',
            400
          )
        );
      }
      try {
        const quote = await getQuote({ anchorDomain, sendAsset, receiveAsset, amount });
        return res.json(quote);
      } catch (err: unknown) {
        logger.error('[sep31] quote error', { error: toMessage(err) });
        return next(new AppError('QUOTE_FETCH_FAILED', 'Failed to get quote', 502, toMessage(err)));
      }
    }
  );

  // POST /api/sep31/send
  router.post(
    '/send',
    jwtAuthMiddleware,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const { anchorDomain, sendAssetCode, receiveAssetCode, amount, receiverId, fields, groupId } =
        req.body as Record<string, string | Record<string, string> | undefined>;
      if (!anchorDomain || !sendAssetCode || !receiveAssetCode || !amount || !receiverId) {
        return next(
          new AppError(
            'MISSING_FIELDS',
            'anchorDomain, sendAssetCode, receiveAssetCode, amount, receiverId are required',
            400
          )
        );
      }
      try {
        const result = await sendPayment({
          anchorDomain: anchorDomain as string,
          sendAssetCode: sendAssetCode as string,
          receiveAssetCode: receiveAssetCode as string,
          amount: amount as string,
          senderId: req.walletAddress!,
          receiverId: receiverId as string,
          fields: (fields as Record<string, string>) ?? {},
          groupId: groupId as string | undefined,
        });
        return res.status(201).json(result);
      } catch (err: unknown) {
        const msg = toMessage(err);
        logger.error('[sep31] send error', { error: msg });
        const isValidation = msg.includes('Missing required compliance');
        return next(
          new AppError(
            isValidation ? 'MISSING_COMPLIANCE_FIELDS' : 'SEP31_SEND_FAILED',
            msg || 'Send failed',
            isValidation ? 422 : 502
          )
        );
      }
    }
  );

  // GET /api/sep31/:id/status?anchorDomain=
  router.get(
    '/:id/status',
    jwtAuthMiddleware,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const { anchorDomain } = req.query as { anchorDomain?: string };
      if (!anchorDomain)
        return next(new AppError('MISSING_FIELDS', 'anchorDomain query param is required', 400));
      try {
        const status = await getPaymentStatus(anchorDomain, req.params.id);
        return res.json(status);
      } catch (err: unknown) {
        const msg = toMessage(err);
        logger.error('[sep31] status error', { error: msg });
        return next(new AppError('SEP31_STATUS_NOT_FOUND', msg || 'Not found', 404));
      }
    }
  );

  return router;
}
