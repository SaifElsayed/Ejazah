// T058, T059 (FR-182, ADR 0021 D1): the admin's subjects, `catalog.subjects.list`, read once into
// the query cache for the application's chips and the subject picker. A subject's name is data in
// both languages, shown in the page's (never a catalogue key).
import type { SubjectSummary } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';

import { type Locale, useLocale } from '../i18n';
import { useApi } from './api';

export const SUBJECTS_QUERY_KEY = ['catalog', 'subjects'] as const;

export function useSubjects() {
  const { client } = useApi();
  return useQuery<SubjectSummary[]>({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: () => client.api.catalog.subjects.list.query(),
  });
}

/** The subject's name in `locale`. */
export function subjectName(subject: Pick<SubjectSummary, 'nameAr' | 'nameEn'>, locale: Locale) {
  return locale === 'ar' ? subject.nameAr : subject.nameEn;
}

/** `subjectName` in the page's language. */
export function useSubjectName(): (subject: Pick<SubjectSummary, 'nameAr' | 'nameEn'>) => string {
  const locale = useLocale();
  return (subject) => subjectName(subject, locale);
}
