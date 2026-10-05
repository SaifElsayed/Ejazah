// gender/require-requester-gender (R-GENDER-5) against a table of type-checked code (T046).
//
// The fixture proves one method: an exported function returning `Promise<readonly TeacherCard[]>`
// with no gender anywhere in its signature. This table proves the rest of the contract row and
// its notes (`specs/001-foundations/contracts/lint-rules.md`), and every way around the rule the
// two reviews of PR #27 found:
//
//   - what is accepted: `RequesterGender` as a required parameter, or as a required property of a
//     required options parameter, and nothing else. Optional and nullable are refused, because
//     the call that leaves the gender out is the unfiltered method; so are a plain `Gender`, the
//     literal union Prisma emits and a string.
//   - where the brand is declared. The cases import `RequesterGender` from the stub on disk at
//     `tests/lint-plugin/virtual/apps/api/src/platform/guards/requester-gender.ts`, the kernel path
//     mirrored under the virtual tree, which is the only place the rule recognises it. A brand
//     with the same key name declared in the repository file itself is a forgery and is refused.
//   - which functions are repository methods: whatever the file exposes to another file, by any
//     export form (inline, `export { x }`, renamed, default, an exported object's members, class
//     methods, property arrows, abstract and static methods, getters). A function that is not
//     exported stays legal.
//   - what "returns teachers" means: a `Teacher…` object type directly or one property step down,
//     with promises, arrays, unions, intersections and type arguments unwrapped around that step.
//     A branded `TeacherId`, an enum `TeacherStatus` and a teacher two property steps down are
//     valid here on purpose; the last is held by review, not by this rule.
//
// Parameter names are never consulted, so the legal cases use names that say nothing about gender
// and the refused ones use a name that does. Every case is a module, because the brand is
// imported, and the spec keeps to two virtual file names (the default project allows eight).

import { loadRule, typeAwareRuleTester, virtualFile } from '../support/rule-tester';

const repository = virtualFile('apps/api/src/modules/catalog/catalog.repository.ts');
const service = virtualFile('apps/api/src/modules/catalog/catalog.service.ts');

const shapes = [
  "import type { RequesterGender } from '../../platform/guards/requester-gender';",
  "type Gender = 'male' | 'female';",
  'interface TeacherCard { readonly id: string }',
  'interface SubjectRow { readonly id: string }',
].join('\n');

function withShapes(code: string): string {
  return `${shapes}\n${code}`;
}

/** The same shapes with the brand forged in the file itself instead of imported from the kernel. */
function withForgedBrand(code: string): string {
  return [
    "type Gender = 'male' | 'female';",
    'declare const requesterGenderBrand: unique symbol;',
    'type RequesterGender = Gender & { readonly [requesterGenderBrand]: true };',
    'interface TeacherCard { readonly id: string }',
    code,
  ].join('\n');
}

interface Refusal {
  readonly name: string;
  readonly code: string;
  readonly method: string;
  readonly teacher?: string;
  readonly messageId?: 'missingGender' | 'plainGender' | 'optionalGender';
}

/** One refused method in the repository file, `missingGender` naming `TeacherCard` unless said otherwise. */
function refused({
  name,
  code,
  method,
  teacher = 'TeacherCard',
  messageId = 'missingGender',
}: Refusal) {
  return {
    name,
    code: withShapes(code),
    filename: repository,
    errors: [{ messageId, data: { name: method, teacher } }],
  };
}

typeAwareRuleTester().run(
  'gender/require-requester-gender',
  loadRule('require-requester-gender.js'),
  {
    valid: [
      {
        name: 'the requester’s gender as a required parameter',
        code: withShapes(
          'export declare function listTeachers(who: RequesterGender, subjectId: string): Promise<readonly TeacherCard[]>;',
        ),
        filename: repository,
      },
      {
        name: 'the requester’s gender as a required property of a required options object',
        code: withShapes(
          'export declare function listTeachers(options: { readonly by: RequesterGender; readonly subjectId: string }): Promise<TeacherCard[]>;',
        ),
        filename: repository,
      },
      {
        name: 'the requester’s gender behind an options interface',
        code: withShapes(
          'interface Query { readonly by: RequesterGender; readonly subjectId: string }\nexport declare function listTeachers(options: Query): Promise<TeacherCard[]>;',
        ),
        filename: repository,
      },
      {
        name: 'the brand survives a mapped options type and a destructured parameter',
        code: withShapes(
          'export async function findTeacher({ by }: Readonly<{ by: RequesterGender }>): Promise<TeacherCard | null> { return by === "male" ? null : null; }',
        ),
        filename: repository,
      },
      {
        name: 'every export form taking the requester’s gender',
        code: withShapes(
          [
            'async function list(who: RequesterGender): Promise<TeacherCard[]> { return who === "male" ? [] : []; }',
            'export { list, list as listTeachers };',
            'export default list;',
            'export const catalogRepository = { search: (who: RequesterGender): Promise<TeacherCard[]> => list(who) };',
            'export abstract class CatalogRepository {',
            '  abstract page(who: RequesterGender): Promise<{ items: TeacherCard[]; nextCursor: string | null }>;',
            '  byGender = (who: RequesterGender): Promise<TeacherCard[]> => list(who);',
            '  static all(who: RequesterGender): Promise<TeacherCard[]> { return list(who); }',
            '}',
          ].join('\n'),
        ),
        filename: repository,
      },
      {
        name: 'a method returning something other than teachers',
        code: withShapes('export declare function listSubjects(): Promise<readonly SubjectRow[]>;'),
        filename: repository,
      },
      {
        name: 'a row carrying a branded TeacherId is not a teacher',
        code: withShapes(
          'declare const teacherIdBrand: unique symbol;\ntype TeacherId = string & { readonly [teacherIdBrand]: true };\ninterface EnrollmentRow { readonly id: string; readonly teacherId: TeacherId }\nexport declare function listEnrollments(): Promise<EnrollmentRow[]>;\nexport declare function teacherIdOf(enrollmentId: string): Promise<TeacherId>;',
        ),
        filename: repository,
      },
      {
        name: 'an enum named TeacherStatus is not an object type',
        code: withShapes(
          'enum TeacherStatus { Pending = "pending", Approved = "approved" }\ninterface ApplicationRow { readonly id: string; readonly status: TeacherStatus }\nexport declare function listApplications(): Promise<ApplicationRow[]>;\nexport declare function statusOf(id: string): Promise<TeacherStatus>;',
        ),
        filename: repository,
      },
      {
        name: 'a teacher two property steps down is held by review, not by this rule',
        code: withShapes(
          'interface Wrapper { readonly page: { readonly items: TeacherCard[] } }\nexport declare function deep(): Promise<Wrapper>;',
        ),
        filename: repository,
      },
      {
        name: 'a teacher behind an index signature is held by review',
        code: withShapes(
          'export declare function byId(): Promise<{ readonly [id: string]: TeacherCard }>;',
        ),
        filename: repository,
      },
      {
        name: 'a private and a #private member are not callable from a student path',
        code: withShapes(
          'export class CatalogRepository {\n  private all(): TeacherCard[] { return []; }\n  #every(): TeacherCard[] { return []; }\n  count(): number { return this.all().length + this.#every().length; }\n}',
        ),
        filename: repository,
      },
      {
        name: 'a function that is not exported, such as a private row mapper',
        code: withShapes(
          'function all(): TeacherCard[] { return []; }\nexport const count = (): number => all().length;',
        ),
        filename: repository,
      },
      {
        name: 'an exported list of teachers is data: its array methods are not repository methods',
        code: withShapes('export declare const featured: readonly TeacherCard[];'),
        filename: repository,
      },
      {
        name: 'a file that is not a repository',
        code: withShapes('export declare function listTeachers(): Promise<TeacherCard[]>;'),
        filename: service,
      },
    ],
    invalid: [
      refused({
        name: 'the fixture’s shape: a promise of a readonly teacher list and no gender',
        code: 'export declare function listTeachersForSubject(subjectId: string): Promise<readonly TeacherCard[]>;',
        method: 'listTeachersForSubject',
      }),
      refused({
        name: 'a parameter named for gender but typed as a string',
        code: 'export declare function listTeachers(requesterGender: string): Promise<TeacherCard[]>;',
        method: 'listTeachers',
      }),

      // The accepted parameter: required, not nullable, branded in the kernel file.
      refused({
        name: 'an optional requester’s gender leaves an unfiltered call (Saif 1)',
        code: 'export declare function findTeacher(id: string, g?: RequesterGender): Promise<TeacherCard | null>;',
        method: 'findTeacher',
        messageId: 'optionalGender',
      }),
      refused({
        name: 'a nullable requester’s gender inside an options object (Saif 1)',
        code: 'export declare function findTeacher(options: Readonly<{ by: RequesterGender | null }>): Promise<TeacherCard | null>;',
        method: 'findTeacher',
        messageId: 'optionalGender',
      }),
      refused({
        name: 'a nullable requester’s gender parameter',
        code: 'export declare function findTeacher(who: RequesterGender | undefined): Promise<TeacherCard | null>;',
        method: 'findTeacher',
        messageId: 'optionalGender',
      }),
      refused({
        name: 'a parameter with a default is optional to the caller',
        code: 'declare const fallback: RequesterGender;\nexport async function findTeacher(who: RequesterGender = fallback): Promise<TeacherCard | null> { return who === "male" ? null : null; }',
        method: 'findTeacher',
        messageId: 'optionalGender',
      }),
      refused({
        name: 'an optional property of the options object',
        code: 'export declare function listTeachers(options: { readonly by?: RequesterGender }): Promise<TeacherCard[]>;',
        method: 'listTeachers',
        messageId: 'optionalGender',
      }),
      refused({
        name: 'a required property of an optional options object',
        code: 'export declare function listTeachers(options?: { readonly by: RequesterGender }): Promise<TeacherCard[]>;',
        method: 'listTeachers',
        messageId: 'optionalGender',
      }),
      {
        name: 'a brand with the same key name forged in the repository file (Saif 2)',
        code: withForgedBrand(
          'export declare function listTeachers(who: RequesterGender): Promise<TeacherCard[]>;',
        ),
        filename: repository,
        errors: [
          { messageId: 'missingGender', data: { name: 'listTeachers', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'a forged brand on any string, optional, as the review wrote it (Saif 2)',
        code: withForgedBrand(
          'type Anything = string & { readonly [requesterGenderBrand]: true };\nexport declare function list(x?: Anything): Promise<TeacherCard[]>;',
        ),
        filename: repository,
        errors: [{ messageId: 'missingGender', data: { name: 'list', teacher: 'TeacherCard' } }],
      },
      refused({
        name: 'a plain Gender parameter, which could be the teacher’s or the client’s',
        code: 'export declare function listTeachers(requesterGender: Gender, subjectId: string): Promise<readonly TeacherCard[]>;',
        method: 'listTeachers',
        messageId: 'plainGender',
      }),
      refused({
        name: 'the literal union Prisma emits for enum Gender is a plain gender too',
        code: "export declare function findTeacher(id: string, requesterGender: 'female' | 'male'): Promise<TeacherCard | null>;",
        method: 'findTeacher',
        messageId: 'plainGender',
      }),
      refused({
        name: 'a plain Gender inside an options object',
        code: 'export declare function listTeachers(options: { readonly requesterGender: Gender; readonly subjectId: string }): Promise<TeacherCard[]>;',
        method: 'listTeachers',
        messageId: 'plainGender',
      }),
      refused({
        name: 'an optional plain Gender is still plain',
        code: 'export declare function findTeacher(id: string, requesterGender?: Gender): Promise<TeacherCard | null>;',
        method: 'findTeacher',
        messageId: 'plainGender',
      }),

      // What "returns teachers" reads.
      refused({
        name: 'an alias hiding the teacher list is resolved through the checker',
        code: 'type Roster = readonly TeacherCard[];\nexport declare function roster(subjectId: string): Promise<Roster>;',
        method: 'roster',
      }),
      refused({
        name: 'an inferred return type from an exported arrow',
        code: 'declare const rows: TeacherCard[];\nexport const everyone = async () => rows;',
        method: 'everyone',
      }),
      refused({
        name: 'a nullable single teacher',
        code: 'export async function byId(id: string): Promise<TeacherCard | null> { return id === "" ? null : { id }; }',
        method: 'byId',
      }),
      refused({
        name: 'a page of teachers in an unnamed object, one property step down (Omar 1, Saif 3)',
        code: 'export declare function page(cursor: string | null): Promise<{ items: TeacherCard[]; nextCursor: string | null }>;',
        method: 'page',
      }),
      refused({
        name: 'a generic alias, read through its type argument (Omar 1, Saif 3)',
        code: 'type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };\nexport declare function page(cursor: string | null): Promise<Page<TeacherCard>>;',
        method: 'page',
      }),
      refused({
        name: 'a generic interface, read through its type argument (Saif 3)',
        code: 'interface Page<T> { readonly items: readonly T[]; readonly nextCursor: string | null }\nexport declare function page(cursor: string | null): Promise<Page<TeacherCard>>;',
        method: 'page',
      }),
      refused({
        name: 'a list of Pick<TeacherCard> (Saif 3)',
        code: "export declare function ids(): Promise<Pick<TeacherCard, 'id'>[]>;",
        method: 'ids',
      }),
      refused({
        name: 'a Map of teachers (Saif 3)',
        code: 'export declare function byId(): Promise<Map<string, TeacherCard>>;',
        method: 'byId',
      }),
      refused({
        name: 'a Record of teachers (Saif 3)',
        code: 'export declare function byId(): Promise<Record<string, TeacherCard>>;',
        method: 'byId',
      }),
      refused({
        name: 'a named wrapper around a list of teachers is read like an unnamed one',
        code: 'interface SearchResult { readonly items: TeacherCard[]; readonly total: number }\nexport declare function search(term: string): Promise<SearchResult>;',
        method: 'search',
      }),
      refused({
        name: 'an intersection alias named Teacher whose members are all object types',
        code: 'interface UserRow { readonly id: string }\ntype TeacherView = UserRow & { readonly bio: string };\nexport declare function views(): Promise<TeacherView[]>;',
        method: 'views',
        teacher: 'TeacherView',
      }),
      refused({
        name: 'a tuple and a union are unwrapped before the property step',
        code: 'export declare function pair(): Promise<[SubjectRow, { readonly teacher: TeacherCard } | null]>;',
        method: 'pair',
      }),

      // Which functions the file exposes.
      refused({
        name: 'a function exported by a separate export list (Omar 2, Saif 4)',
        code: 'function all(): TeacherCard[] { return []; }\nexport { all };',
        method: 'all',
      }),
      refused({
        name: 'a function exported under another name',
        code: 'function all(): TeacherCard[] { return []; }\nexport { all as listTeachers };',
        method: 'all',
      }),
      refused({
        name: 'an arrow bound to a name and exported by a list (Saif 4)',
        code: 'const all = (): TeacherCard[] => [];\nexport { all };',
        method: 'all',
      }),
      refused({
        name: 'export default function (Omar 2)',
        code: 'export default function listAll(): TeacherCard[] { return []; }',
        method: 'listAll',
      }),
      refused({
        name: 'export default of a name (Saif 4)',
        code: 'function all(): TeacherCard[] { return []; }\nexport default all;',
        method: 'all',
      }),
      refused({
        name: 'export default of an anonymous arrow (Saif 4)',
        code: 'export default async (): Promise<TeacherCard[]> => [];',
        method: 'default',
      }),
      refused({
        name: 'a method of an exported object, the repository-object shape (Omar 2, Saif 4)',
        code: 'export const catalogRepository = { async list(): Promise<TeacherCard[]> { return []; } };',
        method: 'list',
      }),
      refused({
        name: 'an arrow property of an exported object',
        code: 'export const catalogRepository = { list: async (): Promise<TeacherCard[]> => [] };',
        method: 'list',
      }),
      refused({
        name: 'a public class method',
        code: 'export class CatalogRepository {\n  async search(term: string): Promise<TeacherCard[]> { return term === "" ? [] : []; }\n}',
        method: 'search',
      }),
      refused({
        name: 'a class property arrow (Saif 4)',
        code: 'export class CatalogRepository {\n  list = async (): Promise<TeacherCard[]> => [];\n}',
        method: 'list',
      }),
      refused({
        name: 'a class getter, which can take no gender at all (Saif 4)',
        code: 'export class CatalogRepository {\n  get everyone(): TeacherCard[] { return []; }\n}',
        method: 'everyone',
      }),
      refused({
        name: 'an abstract method (Saif 4)',
        code: 'export abstract class CatalogRepository {\n  abstract list(): Promise<TeacherCard[]>;\n}',
        method: 'list',
      }),
      refused({
        name: 'a static method',
        code: 'export class CatalogRepository {\n  static list(): TeacherCard[] { return []; }\n}',
        method: 'list',
      }),
      refused({
        name: 'a method of a class that is exposed only as an instance',
        code: 'class CatalogRepository {\n  list(): TeacherCard[] { return []; }\n}\nexport const catalogRepository = new CatalogRepository();',
        method: 'list',
      }),
      {
        name: 'each overload is a signature a caller may pick',
        code: withShapes(
          'export function find(id: string): Promise<TeacherCard | null>;\nexport function find(id: string, who: RequesterGender): Promise<TeacherCard | null>;\nexport async function find(id: string, who?: RequesterGender): Promise<TeacherCard | null> { return id === who ? null : null; }',
        ),
        filename: repository,
        errors: [{ messageId: 'missingGender', data: { name: 'find', teacher: 'TeacherCard' } }],
      },
      {
        name: 'a function exported twice is reported once',
        code: withShapes(
          'function all(): TeacherCard[] { return []; }\nexport { all, all as everyone };\nexport default all;',
        ),
        filename: repository,
        errors: [{ messageId: 'missingGender', data: { name: 'all', teacher: 'TeacherCard' } }],
      },
    ],
  },
);
