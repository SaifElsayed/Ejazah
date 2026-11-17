// T065, T067 (FR-176): `home.summary`, the admin home. Two queue cards, the ones this phase builds:
// the applications waiting for a decision, with the oldest's age in whole hours and how many wait on
// the applicant, and the credentials waiting for review, with the oldest's age (B14d) and how many
// are for a subject added after approval; the other six cards are absent until their phases. Then the newest
// `admin_home_latest_actions` entries of the log, the reads left out (owner's decision 2026-10-21).
//
// The queues' tables are the identity and catalog modules' (R-API-6), read through their entries,
// which `index.ts` binds; the age is counted by `@ijazah/time` from the clock handed in (R-TIME-1).
//
// 003:T109 (SRS DEC-87; Q-B4 (a)): the summary also answers the server's payment mode, handed in by
// `main.ts` from `PAYMENT_MODE`, so the console draws «نسخة تجريبية» in `test`.
import { wholeHoursSince } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { AuditListRow, AuditQueryService } from './audit-query.service.js';

export const LATEST_ACTIONS_SETTING = 'admin_home_latest_actions';

const positiveWhole = z.int().positive();

/** What the two queue cards count, each read by the module whose table it is. */
export interface HomeQueues {
  /** `teacher_profiles`: the applications in review, the oldest's submission, those needing a document. */
  applications(tx: Transaction): Promise<{
    readonly open: number;
    readonly oldestSubmittedAt: Date | null;
    readonly waitingOnApplicant: number;
  }>;
  /** `teacher_credentials`: those pending, and those of them added after approval. */
  credentials(tx: Transaction): Promise<{
    readonly open: number;
    readonly addedSubjects: number;
    readonly oldestSubmittedAt: Date | null;
  }>;
}

export interface HomeDependencies {
  readonly settings: SettingsReader;
  readonly audit: Pick<AuditQueryService, 'latest'>;
  readonly queues: HomeQueues;
  /** 003:T109: the server's payment mode (`config.PAYMENT_MODE`). */
  readonly paymentMode: 'test' | 'live';
  readonly now?: () => Date;
}

export class HomeService {
  readonly #settings: SettingsReader;
  readonly #audit: HomeDependencies['audit'];
  readonly #queues: HomeQueues;
  readonly #paymentMode: HomeDependencies['paymentMode'];
  readonly #now: () => Date;

  constructor(dependencies: HomeDependencies) {
    this.#settings = dependencies.settings;
    this.#audit = dependencies.audit;
    this.#queues = dependencies.queues;
    this.#paymentMode = dependencies.paymentMode;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `home.summary`: the two queue cards and the latest actions. */
  async summary(tx: Transaction): Promise<{
    readonly queues: {
      readonly applications: {
        readonly open: number;
        readonly oldestAgeHours?: number;
        readonly waitingOnApplicant: number;
      };
      readonly credentials: {
        readonly open: number;
        readonly oldestAgeHours?: number;
        readonly addedSubjects: number;
      };
    };
    readonly latestActions: AuditListRow[];
    readonly paymentMode: HomeDependencies['paymentMode'];
  }> {
    const count = await this.#settings.read(LATEST_ACTIONS_SETTING, positiveWhole);
    const applications = await this.#queues.applications(tx);
    const credentials = await this.#queues.credentials(tx);
    const latestActions = await this.#audit.latest(tx, count);
    const oldest = applications.oldestSubmittedAt;
    const oldestCredential = credentials.oldestSubmittedAt;
    return {
      queues: {
        applications: {
          open: applications.open,
          ...(oldest === null ? {} : { oldestAgeHours: wholeHoursSince(oldest, this.#now()) }),
          waitingOnApplicant: applications.waitingOnApplicant,
        },
        credentials: {
          open: credentials.open,
          ...(oldestCredential === null
            ? {}
            : { oldestAgeHours: wholeHoursSince(oldestCredential, this.#now()) }),
          addedSubjects: credentials.addedSubjects,
        },
      },
      latestActions,
      paymentMode: this.#paymentMode,
    };
  }
}
