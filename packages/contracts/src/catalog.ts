// T038: the `catalog` namespace of the user surface as this phase serves it (app-surface.md
// "`platform` and `catalog`"; FR-182, ADR 0021 D1): the active subjects with both names, for the
// application form, the subject picker and the home chips. The English name is data, shown where
// the page's language says; no catalogue key holds a subject name.
import { z } from 'zod';

export const subjectSummary = z.object({
  id: z.uuid(),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
});

export type SubjectSummary = z.infer<typeof subjectSummary>;

/** `catalog.subjects.list`'s answer. */
export const subjectsListOutput = z.array(subjectSummary);
