import { Router } from 'express';

import { jwtAuthMiddleware } from '../auth_middleware';
import { rampProtection } from '../fiat_ramp_protection';
import { AppError } from '../lib/errors';
import { logger } from '../logger';
import { getKycStatus } from '../services/kyc';
import { initiateDeposit, initiateWithdraw, syncTransactionStatus, getTransaction, CircuitBreakerOpenError } from '../services/sep24';

import type { AuthenticatedRequest } from '../auth_middleware';
import type { Response, NextFunction } from 'express';

/** Narrow an unknown catch value to a message string. */
function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Returns true when the error indicates a tripped circuit breaker. */
function isCircuitOpen(err: unknown): boolean {
  return (
    err instanceof CircuitBreakerOpenError ||
    (err instanceof Error && (err as Error & { code?: string }).code === 'CIRCUIT_OPEN')
  );
}

export function createRampRouter(): Router {
  const router = Router();

  // POST /api/ramp/deposit
  router.post(
    '/deposit',
    jwtAuthMiddleware,
    rampProtection({ velocityCheck: true }),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const { anchorDomain, assetCode, assetIssuer, amount, stellarAccount } = req.body as Record<
        string,
        string
      >;
      if (!anchorDomain || !assetCode || !stellarAccount) {
        return next(
          new AppError(
            'MISSING_FIELDS',
            'anchorDomain, assetCode, stellarAccount are required',
            400
          )
        );
      }
      const kyc = await getKycStatus(req.walletAddress!);
      if (kyc.status !== 'approved') {
        return next(
          new AppError('KYC_REQUIRED', 'KYC approval required to use fiat ramp', 403, {
            kycStatus: kyc.status,
          })
        );
      }
      try {
        const result = await initiateDeposit({
          anchorDomain,
          assetCode,
          assetIssuer,
          amount,
          stellarAccount,
          userId: req.walletAddress!,
        });
        return res.status(201).json(result);
      } catch (err: unknown) {
        logger.error('[ramp] deposit initiation failed', { error: toMessage(err) });
        if (isCircuitOpen(err)) {
          return next(
            new AppError(
              'RAMP_CIRCUIT_OPEN',
              'Fiat ramp provider is currently unavailable (circuit open)',
              503,
              toMessage(err)
            )
          );
        }
        return next(
          new AppError('DEPOSIT_INITIATION_FAILED', 'Failed to initiate deposit', 502, toMessage(err))
        );
      }
    }
  );

  // POST /api/ramp/withdraw
  router.post(
    '/withdraw',
    jwtAuthMiddleware,
    rampProtection({ velocityCheck: true }),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const { anchorDomain, assetCode, assetIssuer, amount, stellarAccount } = req.body as Record<
        string,
        string
      >;
      if (!anchorDomain || !assetCode || !stellarAccount) {
        return next(
          new AppError(
            'MISSING_FIELDS',
            'anchorDomain, assetCode, stellarAccount are required',
            400
          )
        );
      }
      const kyc = await getKycStatus(req.walletAddress!);
      if (kyc.status !== 'approved') {
        return next(
          new AppError('KYC_REQUIRED', 'KYC approval required to use fiat ramp', 403, {
            kycStatus: kyc.status,
          })
        );
      }
      try {
        const result = await initiateWithdraw({
          anchorDomain,
          assetCode,
          assetIssuer,
          amount,
          stellarAccount,
          userId: req.walletAddress!,
        });
        return res.status(201).json(result);
      } catch (err: unknown) {
        logger.error('[ramp] withdraw initiation failed', { error: toMessage(err) });
        if (isCircuitOpen(err)) {
          return next(
            new AppError(
              'RAMP_CIRCUIT_OPEN',
              'Fiat ramp provider is currently unavailable (circuit open)',
              503,
              toMessage(err)
            )
          );
        }
        return next(
          new AppError(
            'WITHDRAW_INITIATION_FAILED',
            'Failed to initiate withdraw',
            502,
            toMessage(err)
          )
        );
      }
    }
  );

  // GET /api/ramp/:id/status — sync and return latest status
  router.get(
    '/:id/status',
    jwtAuthMiddleware,
    rampProtection({ velocityCheck: false }),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const record = await syncTransactionStatus(req.params.id);
        return res.json(record);
      } catch (err: unknown) {
        logger.error('[ramp] status sync failed', { error: toMessage(err) });
        if (isCircuitOpen(err)) {
          return next(
            new AppError(
              'RAMP_CIRCUIT_OPEN',
              'Fiat ramp provider is currently unavailable (circuit open)',
              503,
              toMessage(err)
            )
          );
        }
        return next(new AppError('RAMP_TRANSACTION_NOT_FOUND', toMessage(err) || 'Not found', 404));
      }
    }
  );

  // GET /api/ramp/:id
  router.get(
    '/:id',
    jwtAuthMiddleware,
    rampProtection({ velocityCheck: false }),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const record = await getTransaction(req.params.id);
        return res.json(record);
      } catch (err: unknown) {
        return next(new AppError('RAMP_TRANSACTION_NOT_FOUND', toMessage(err) || 'Not found', 404));
      }
    }
  );

  return router;
}
