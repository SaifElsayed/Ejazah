// T112 — a queued job and the dispatch that runs it (FR-052, R-API-14, R-SEC-2).
//
// The queue hands the worker a name and a payload; these cases prove what happens to them before
// any handler runs: the payload is checked against the job's own schema, a name nobody registered
// fails the delivery instead of running a guess, and two jobs can never share a name. No Redis is
// needed: the dispatch is the function BullMQ calls, and it is called here directly.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDispatcher, defineJob } from './job.js';

function recordingJob(name: string, schedule?: string) {
  const runs: unknown[] = [];
  const job = defineJob({
    name,
    payload: schedule === undefined ? z.object({ enrollmentId: z.uuid() }) : z.object({}),
    ...(schedule === undefined ? {} : { schedule }),
    run: async (payload) => {
      runs.push(payload);
    },
  });
  return { job, runs };
}

const enrollmentId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('a job (T112)', () => {
  it('runs its handler with the payload its schema accepts', async () => {
    const { job, runs } = recordingJob('confirm-enrollment');
    await job.handle({ enrollmentId });
    expect(runs).toEqual([{ enrollmentId }]);
  });

  it('refuses a payload its schema does not accept, before the handler runs', async () => {
    const { job, runs } = recordingJob('confirm-enrollment');
    await expect(job.handle({ enrollmentId: 'not-an-id' })).rejects.toThrow();
    await expect(job.handle(undefined)).rejects.toThrow();
    expect(runs).toEqual([]);
  });

  it('is named in kebab-case, as its file is', () => {
    expect(() => recordingJob('confirmEnrollment')).toThrow(/kebab-case/);
    expect(() => recordingJob('')).toThrow(/kebab-case/);
  });

  it('runs on a schedule only when it needs no payload, since a scheduled run carries none', () => {
    expect(() =>
      defineJob({
        name: 'expire-holds',
        payload: z.object({ slotId: z.uuid() }),
        schedule: '* * * * *',
        run: async () => {},
      }),
    ).toThrow(/scheduled/);
    expect(recordingJob('expire-holds', '* * * * *').job.schedule).toBe('* * * * *');
  });
});

describe('the dispatch (T112)', () => {
  it('runs the job the queue names, and only that one', async () => {
    const first = recordingJob('confirm-enrollment');
    const second = recordingJob('expire-pending-payments');
    const dispatch = createDispatcher([first.job, second.job]);

    await dispatch({ name: 'expire-pending-payments', data: { enrollmentId } });

    expect(first.runs).toEqual([]);
    expect(second.runs).toEqual([{ enrollmentId }]);
  });

  it('fails a delivery whose name no job carries', async () => {
    const { job, runs } = recordingJob('confirm-enrollment');
    const dispatch = createDispatcher([job]);

    await expect(dispatch({ name: 'confirm-enrolment', data: { enrollmentId } })).rejects.toThrow(
      /No job is named "confirm-enrolment"/,
    );
    expect(runs).toEqual([]);
  });

  it('refuses two jobs of one name', () => {
    const { job } = recordingJob('confirm-enrollment');
    expect(() => createDispatcher([job, recordingJob('confirm-enrollment').job])).toThrow(
      /Two jobs are named "confirm-enrollment"/,
    );
  });
});
