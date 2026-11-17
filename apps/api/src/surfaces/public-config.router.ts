// T038: `platform.publicConfig` (app-surface.md "`platform` and `catalog`"; FR-145, ADR 0021 D4).
//
// One public, rate-limited query answering the support address and the current Terms version,
// the two values every app needs before anyone signs in. The address is `SUPPORT_EMAIL` from the
// configuration, never an admin setting (an admin account taken over must not point people at
// another mailbox); the version is the `terms_version` setting, read on every call (FR-034). Both
// reach the handler through the services the request context carries (`AppServices`), so this
// router is a static value the contract snapshot reads. It is a query, so an HTTP cache may hold
// its answer; the apps cache the last value and never block start-up on it.
//
// T002 (FR-383, FR-412): it also answers the four numbers the phone reads a pending checkout by,
// each from its setting on every call, so an administrator's change reaches the phone without a
// release. The keys are named here because nothing else on the server reads them.
//
// The file lives beside the surfaces, not under `platform/`, because a procedure is built from the
// surface's caller kinds and the kernel depends on nothing above it (ARCHITECTURE §4; PR #79
// review, finding 1).
//
// 003:T104 (Q-A3 (a), ADR 0025 D1): it also answers the teacher's share rate, read on every call
// from the setting the checkout reads when it creates an order, so the package editor shows the
// teacher's share as the price is typed. The rate is not secret: the Terms state the commission.
//
// 003:T109 (SRS DEC-87): it answers the payment mode the server runs in, so every app shows
// «نسخة تجريبية» in test mode. A surface that wired no mode fails closed rather than answer one.
import {
  checkoutPolling,
  publicConfigOutput,
  teacherSharePercent,
  termsVersion,
} from '@ijazah/contracts';
import { z } from 'zod';
import { TEACHER_SHARE_SETTING } from '../modules/payments/index.js';
import { TERMS_VERSION_SETTING } from '../platform/settings/keys.js';
import { PUBLIC_PAGE_RATE_LIMIT } from '../platform/web/route.js';
import { createAppRouter, publicProcedure } from './procedures.js';

/** Each checkout number's setting (specs/003-booking/data-model.md §4; SRS §3.14). */
const CHECKOUT_SETTINGS = {
  confirmationTimeoutSeconds: 'checkout_confirmation_timeout_seconds',
  processingPollSeconds: 'checkout_processing_poll_seconds',
  confirmingPollSeconds: 'checkout_confirming_poll_seconds',
  confirmingPollWindowMinutes: 'checkout_confirming_poll_window_minutes',
} as const;

export const platformRouter = createAppRouter({
  publicConfig: publicProcedure({
    input: z.void(),
    output: publicConfigOutput,
    rateLimit: { key: PUBLIC_PAGE_RATE_LIMIT, subjectOf: ({ ctx }) => ctx.clientAddress },
  }).query(async ({ ctx }) => {
    const { settings } = ctx.services;
    const read = (field: keyof typeof CHECKOUT_SETTINGS) =>
      settings.read(CHECKOUT_SETTINGS[field], checkoutPolling.shape[field]);
    const [
      version,
      confirmationTimeoutSeconds,
      processingPollSeconds,
      confirmingPollSeconds,
      confirmingPollWindowMinutes,
      sharePercent,
    ] = await Promise.all([
      settings.read(TERMS_VERSION_SETTING, termsVersion),
      read('confirmationTimeoutSeconds'),
      read('processingPollSeconds'),
      read('confirmingPollSeconds'),
      read('confirmingPollWindowMinutes'),
      settings.read(TEACHER_SHARE_SETTING, teacherSharePercent),
    ]);
    const { paymentMode } = ctx.services.publicConfig;
    if (paymentMode === undefined) {
      throw new Error('platform.publicConfig: no payment mode is wired (003:T109)');
    }
    return {
      supportEmail: ctx.services.publicConfig.supportEmail,
      termsVersion: version,
      checkout: {
        confirmationTimeoutSeconds,
        processingPollSeconds,
        confirmingPollSeconds,
        confirmingPollWindowMinutes,
      },
      teacherSharePercent: sharePercent,
      paymentMode,
    };
  }),
});
