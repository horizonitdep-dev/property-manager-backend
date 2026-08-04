import { Prisma } from '@prisma/client';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';

/** "Expiring soon" window used by both the effective-status computation and its list-filter equivalent. */
export const EXPIRING_SOON_WINDOW_DAYS = 30;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Pure helper: derives the EFFECTIVE status returned by the API from the stored
 * manual status (DRAFT | ACTIVE | TERMINATED) + endDate. DRAFT/TERMINATED pass
 * through unchanged; ACTIVE is further split into ACTIVE / EXPIRING_SOON / EXPIRED
 * based on how endDate compares to today. Used by every read path — never persisted.
 */
export function computeEffectiveStatus(
  storedStatus: ContractStatus,
  endDate: Date,
  today: Date = new Date(),
): ContractStatus {
  if (storedStatus === ContractStatus.DRAFT) return ContractStatus.DRAFT;
  if (storedStatus === ContractStatus.TERMINATED) return ContractStatus.TERMINATED;

  const todayStart = startOfDay(today);
  const end = startOfDay(endDate);
  const soonCutoff = addDays(todayStart, EXPIRING_SOON_WINDOW_DAYS);

  if (end < todayStart) return ContractStatus.EXPIRED;
  if (end <= soonCutoff) return ContractStatus.EXPIRING_SOON;
  return ContractStatus.ACTIVE;
}

/**
 * Translates a requested (possibly computed) status filter into the equivalent
 * Prisma predicate against the stored column + endDate, since EXPIRING_SOON and
 * EXPIRED are never written to the `status` column. Mirrors computeEffectiveStatus's
 * boundaries exactly so filtering and display never disagree.
 */
export function buildStatusFilter(
  status: ContractStatus,
  today: Date = new Date(),
): Prisma.ContractWhereInput {
  const todayStart = startOfDay(today);
  const soonCutoff = addDays(todayStart, EXPIRING_SOON_WINDOW_DAYS);

  switch (status) {
    case ContractStatus.DRAFT:
    case ContractStatus.TERMINATED:
      return { status };
    case ContractStatus.EXPIRED:
      return { status: ContractStatus.ACTIVE, endDate: { lt: todayStart } };
    case ContractStatus.EXPIRING_SOON:
      return { status: ContractStatus.ACTIVE, endDate: { gte: todayStart, lte: soonCutoff } };
    case ContractStatus.ACTIVE:
      return { status: ContractStatus.ACTIVE, endDate: { gt: soonCutoff } };
  }
}
