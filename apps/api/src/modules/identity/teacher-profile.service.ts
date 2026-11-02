// T017 (FR-310, FR-PROFILE-1, R-GENDER-6, research R-218): the approved teacher's own public
// profile. The specs are teacher-profile.service.spec.ts (over the database) and the router's
// refusals (teacher-profile.router.spec.ts).
//
// - `get` answers the display name, the photo as a signed link that lapses after
//   `document_link_ttl_seconds` (never the storage key, `users.photo_key`, which only
//   `POST /uploads/photos` writes), the bio, the qualification summary, the gender of the account,
//   and `published`: the visibility predicate's answer for this teacher as a same-gender student
//   would get it (FR-315), asked of the predicate itself with the session's gender
//   (`isPublishedTeacher`, which `teacher.packages.list` asks too), so it holds exactly when
//   discovery would show the teacher.
// - `update` writes the bio and the qualification summary and nothing else: the display name stays
//   `account.updateProfile`'s (T158), the photo the upload route's, and no input names the gender
//   (R-GENDER-6). One conditional statement on the approved profile, no lock: no read decides it
//   (T005's rule 1), and it holds no lock but its own row's, so no order is at stake (rule 2).
import type {
  TeacherProfileGetOutput,
  TeacherProfileUpdateInput,
  TeacherProfileUpdateOutput,
} from '@ijazah/contracts';

import type { Database } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { TeacherProfileRepository } from './teacher-profile.repository.js';
import { isPublishedTeacher } from './visible-teachers.repository.js';

/** What the profile is built over. */
export interface TeacherProfileDependencies {
  readonly database: Pick<Database, 'user' | 'teacherProfile'>;
  readonly settings: SettingsReader;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
}

export class TeacherProfileService {
  readonly #profiles: TeacherProfileRepository;
  readonly #dependencies: TeacherProfileDependencies;

  constructor(dependencies: TeacherProfileDependencies) {
    this.#dependencies = dependencies;
    this.#profiles = new TeacherProfileRepository(dependencies.database);
  }

  /** The teacher's own profile; `requester` is the session's gender, the teacher's own. */
  async get(teacherUserId: string, requester: RequesterGender): Promise<TeacherProfileGetOutput> {
    const [row, published] = await Promise.all([
      this.#profiles.readOwn(teacherUserId),
      isPublishedTeacher(this.#dependencies.database, requester, teacherUserId),
    ]);
    if (row === null) throw new DomainError('FORBIDDEN');
    const photoUrl = await this.#photoUrl(row.photoKey);
    return {
      displayName: row.displayName,
      ...(photoUrl === undefined ? {} : { photoUrl }),
      bio: row.bio,
      qualificationSummary: row.qualificationSummary,
      gender: row.gender,
      published,
    };
  }

  /** The bio and the qualification summary; FORBIDDEN, nothing written, without an approved profile. */
  async update(
    teacherUserId: string,
    input: TeacherProfileUpdateInput,
  ): Promise<TeacherProfileUpdateOutput> {
    const texts = { bio: input.bio, qualificationSummary: input.qualificationSummary };
    if (!(await this.#profiles.writeTexts(teacherUserId, texts))) {
      throw new DomainError('FORBIDDEN');
    }
    return texts;
  }

  async #photoUrl(photoKey: string | null): Promise<string | undefined> {
    if (photoKey === null) return undefined;
    const seconds = await this.#dependencies.settings.read(
      DOCUMENT_LINK_TTL_SETTING,
      documentLinkTtl,
    );
    return this.#dependencies.storage.temporaryLink(photoKey, seconds);
  }
}
