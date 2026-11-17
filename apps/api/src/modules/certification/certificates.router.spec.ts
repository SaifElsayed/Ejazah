// T009 of specs/005-certification — `certificates.list` and `certificates.link` as the user surface
// serves them (FR-607, FR-609; contracts/app-surface.md, `certificates.*`; R-MOBILE-13). The
// authorization-test gate (`scripts/authz-test-gate.ts`, T028) reads module specs only, so each
// path's refusals are named here (the follow-up under T006), beside the attacks of
// `tests/adversarial/certificates.attacks.spec.ts`.
//
// The participant kind: an anonymous caller UNAUTHENTICATED, a suspended or banned account
// ACCOUNT_RESTRICTED, none of them reaching the service; a student and a teacher both reach it, with
// the session's own account and never an account the input names (R-GENDER-4). The service's
// answers (NOT_FOUND for anyone not a party, `not_ready`, `revoked`) are certificates.service.spec.ts's.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { certificatesRouter } from './certificates.router.js';
import type { CertificationServices } from './index.js';

const CALLER = '0199d0a0-0000-7000-8000-0000000009d1';
const SOMEONE_ELSE = '0199d0a0-0000-7000-8000-0000000009d2';
const IJAZAH = '0199d0a0-0000-7000-8000-0000000009b1';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-0000000009c1', nameAr: 'القرآن', nameEn: 'Quran' };
const LINK = 'https://storage.example.invalid/signed?k=x';

const callerFor = createAppCallerFactory(createAppRouter({ certificates: certificatesRouter }));
type Caller = ReturnType<typeof callerFor>;

type Standing = 'student' | 'teacher' | 'suspended' | 'banned';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000009c9',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  return {
    ...base,
    role: 'teacher',
    accountStatus: standing === 'teacher' ? 'active' : standing,
    teacher: {
      verificationStatus: 'approved',
      payoutVerified: true,
      applicationStatus: 'approved',
    },
  };
}

/** Every call that reached the service: its method and the arguments it was given. */
let reached: { method: string; args: unknown[] }[];

beforeEach(() => {
  reached = [];
});

function callerAs(session: UserSession | null): Caller {
  const certification = {
    ijazahRequests: unusedCertificationRequests(),
    certificates: {
      list: async (...args: unknown[]) => {
        reached.push({ method: 'list', args });
        return {
          items: [
            {
              ijazahId: IJAZAH,
              subject: SUBJECT,
              teacherName: 'فاطمة بنت علي',
              issuedAt: '2026-11-17T10:00:00.000Z',
              revoked: false,
              ready: true,
              certificateStorageKey: `certificates/${IJAZAH}/0.pdf`,
            },
          ],
        };
      },
      link: async (...args: unknown[]) => {
        reached.push({ method: 'link', args });
        return { link: LINK, certificateStorageKey: `certificates/${IJAZAH}/0.pdf` };
      },
    },
  } as unknown as CertificationServices;
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    catalog: unusedCatalogServices,
    certification,
  };
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = { check: vi.fn(async () => undefined) } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

function unusedCertificationRequests() {
  return new Proxy(
    {},
    {
      get: (_target, method) => () =>
        Promise.reject(new Error(`spec: ijazahRequests.${String(method)} reached`)),
    },
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe('certificates.list (T009 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED', async () => {
    await expect(callerAs(null).certificates.list()).rejects.toEqual(refused('UNAUTHENTICATED'));
    expect(reached).toEqual([]);
  });

  it('refuses a suspended or a banned account ACCOUNT_RESTRICTED', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(callerAs(sessionOf(standing)).certificates.list(), standing).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
    }
    expect(reached).toEqual([]);
  });

  it('answers a student and a teacher, each with the session’s own account, the key stripped', async () => {
    for (const standing of ['student', 'teacher'] as const) {
      reached = [];
      const answer = await callerAs(sessionOf(standing)).certificates.list();
      expect(reached, standing).toEqual([{ method: 'list', args: [CALLER] }]);
      expect(JSON.stringify(answer), standing).not.toContain('certificates/');
      expect(answer.items.map((item) => item.ijazahId)).toEqual([IJAZAH]);
    }
  });
});

describe('certificates.link (T009 of specs/005-certification)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED', async () => {
    await expect(callerAs(null).certificates.link({ ijazahId: IJAZAH })).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(reached).toEqual([]);
  });

  it('refuses a suspended or a banned account ACCOUNT_RESTRICTED', async () => {
    for (const standing of ['suspended', 'banned'] as const) {
      await expect(
        callerAs(sessionOf(standing)).certificates.link({ ijazahId: IJAZAH }),
        standing,
      ).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
    }
    expect(reached).toEqual([]);
  });

  it('refuses an id that is not one BAD_REQUEST before the service', async () => {
    await expect(
      callerAs(sessionOf('student')).certificates.link({ ijazahId: 'not an id' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(reached).toEqual([]);
  });

  it('answers a student and a teacher with the session’s own account, never one the input names', async () => {
    for (const standing of ['student', 'teacher'] as const) {
      reached = [];
      const answer = await callerAs(sessionOf(standing)).certificates.link({
        ijazahId: IJAZAH,
        userId: SOMEONE_ELSE,
      } as never);
      expect(reached, standing).toEqual([{ method: 'link', args: [CALLER, { ijazahId: IJAZAH }] }]);
      expect(answer, standing).toEqual({ link: LINK });
    }
  });
});
