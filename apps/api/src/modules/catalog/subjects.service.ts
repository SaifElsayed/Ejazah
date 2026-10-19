// T038: the subjects read, the catalog module's one rule holder for the public list (FR-182).
// There is no rule yet beyond "the active ones, both names": the repository filters, this service
// is where a rule lands when one arrives (R-API-2), and the router calls it and nothing else.
import type { SubjectSummary } from '@ijazah/contracts';
import type { SubjectsRepository } from './subjects.repository.js';

/** What the user surface reads of the subjects, through the request context's services. */
export interface SubjectsReader {
  listActive(): Promise<SubjectSummary[]>;
}

export class SubjectsService implements SubjectsReader {
  readonly #subjects: Pick<SubjectsRepository, 'listActive'>;

  constructor(subjects: Pick<SubjectsRepository, 'listActive'>) {
    this.#subjects = subjects;
  }

  listActive(): Promise<SubjectSummary[]> {
    return this.#subjects.listActive();
  }
}
