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
//     export form (inline, `export { x }`, renamed, default, re-exported, an exported object's
//     members, class methods, property arrows, abstract and static methods, getters), wherever the
//     member is declared outside a library (a base class, an imported interface or object, which
//     the second review of PR #27 found unread), a class exposed as a value, the members of a
//     callable export, and what an exported function returns one level down (a factory, a curried
//     function). A function that is not exported stays legal, and so do `private` members; a
//     `protected` one and a gender inside a rest tuple are refused, which fails closed.
//   - what "returns teachers" means: a `Teacher…` object type directly or one property step down,
//     with promises, arrays, unions, intersections and type arguments unwrapped around that step.
//     A branded `TeacherId`, an enum `TeacherStatus` and a teacher two property steps down are
//     valid here on purpose; the last is held by review, not by this rule.
//
// Parameter names are never consulted, so the legal cases use names that say nothing about gender
// and the refused ones use a name that does. Every case is a module, because the brand is
// imported, and the spec keeps to three virtual file names (the default project allows eight).
// The multi-file cases import from `catalog.base.ts`, a second file on disk under the virtual
// tree beside the brand stub: a case's code exists only in memory, so what it imports from
// another file has to be readable from disk.

import { loadRule, typeAwareRuleTester, virtualFile } from '../support/rule-tester';

const repository = virtualFile('apps/api/src/modules/catalog/catalog.repository.ts');
const service = virtualFile('apps/api/src/modules/catalog/catalog.service.ts');
const nameless = virtualFile('apps/api/src/modules/catalog/.repository.ts');

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
        name: 'a factory whose returned methods take the requester’s gender',
        code: withShapes(
          'export function createRepository() {\n  return { list(who: RequesterGender): TeacherCard[] { return who === "male" ? [] : []; } };\n}',
        ),
        filename: repository,
      },
      {
        name: 'a file named .repository.ts with no name in front is not a repository file (Nit 11)',
        code: withShapes('export declare function listTeachers(): Promise<TeacherCard[]>;'),
        filename: nameless,
      },
      {
        name: 'a file that is not a repository',
        code: withShapes('export declare function listTeachers(): Promise<TeacherCard[]>;'),
        filename: service,
      },
      {
        name: 'the generated payload of a model that is not a teacher, as a settings read returns (condition under T055)',
        code: withShapes(
          [
            "import type { Prisma, PrismaClient } from '@prisma/client';",
            'declare const prisma: PrismaClient;',
            'type SettingRow = Prisma.SettingGetPayload<{ select: { value: true } }>;',
            'export declare function valueOf(key: string): Promise<SettingRow | null>;',
            'export async function read(key: string) {',
            '  return prisma.setting.findUnique({ where: { key }, select: { value: true } });',
            '}',
          ].join('\n'),
        ),
        filename: repository,
      },
      {
        name: 'the database client and a transaction client, whose teacher delegates are accessors, not rows (DECISION (T102))',
        code: withShapes(
          [
            "import type { Prisma, PrismaClient } from '@prisma/client';",
            'export declare function openDatabase(url: string): PrismaClient;',
            'export declare function transactionOf(database: PrismaClient): Prisma.TransactionClient;',
          ].join('\n'),
        ),
        filename: repository,
      },
      // T152: the client's exemption covers the client's own declarations only, and still covers
      // every client the note under T102 accepts, the extended one of T148 included.
      {
        name: 'a client extended with no extension, and one carrying a second client as a member, as T148 builds it (T152)',
        code: withShapes(
          [
            "import { PrismaClient } from '@prisma/client';",
            'declare const base: PrismaClient;',
            'export function extended() {',
            '  return base.$extends({});',
            '}',
            'export function withOptIn() {',
            '  return base.$extends({ client: { includeDeleted: base } });',
            '}',
          ].join('\n'),
        ),
        filename: repository,
      },
      {
        name: 'user rows, picked and omitted under aliases that name no teacher (T152)',
        code: withShapes(
          [
            "import type { User } from '@prisma/client';",
            "type Account = Pick<User, 'id' | 'displayName'>;",
            "type Contact = Omit<User, 'passwordHash'>;",
            "type Names = { [K in 'id' | 'displayName']: User[K] };",
            'export declare function findAccount(id: string): Promise<Account | null>;',
            'export declare function findContact(id: string): Promise<Contact | null>;',
            'export declare function findNames(id: string): Promise<Names | null>;',
          ].join('\n'),
        ),
        filename: repository,
      },
      {
        name: 'a picked teacher returned by a method that takes the requester’s gender (T152)',
        code: withShapes(
          [
            "import type { TeacherProfile } from '@prisma/client';",
            "type Card = Pick<TeacherProfile, 'id' | 'bio'>;",
            'export declare function findCard(who: RequesterGender, id: string): Promise<Card | null>;',
          ].join('\n'),
        ),
        filename: repository,
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
      refused({
        name: 'a protected method is read: a subclass can expose it, so the rule fails closed (Nit 9)',
        code: 'export class CatalogRepository {\n  protected list(): TeacherCard[] { return []; }\n}',
        method: 'list',
      }),
      refused({
        name: 'the gender inside a rest tuple is refused as optional, which fails closed (Nit 9)',
        code: 'export declare function list(...args: [who: RequesterGender, id: string]): TeacherCard[];',
        method: 'list',
        messageId: 'optionalGender',
      }),

      // Members declared in another file are read too (Major 1 of the second review). The other
      // file is `catalog.base.ts`, on disk beside this virtual repository; nothing in it takes a
      // gender.
      refused({
        name: 'a class extending a generic base from another file (Major 1)',
        code: "import { BaseRepository } from './catalog.base';\nexport class CatalogRepository extends BaseRepository<TeacherCard> {}",
        method: 'all',
      }),
      refused({
        name: 'a class extending a base from another file that returns teachers (Major 1)',
        code: "import { TeacherBase } from './catalog.base';\nexport class CatalogRepository extends TeacherBase {}",
        method: 'list',
      }),
      refused({
        name: 'an exported instance of an imported class (Major 1)',
        code: "import { TeacherBase } from './catalog.base';\nexport const catalogRepository = new TeacherBase();",
        method: 'list',
      }),
      refused({
        name: 'an exported const typed by an interface from another file (Major 1)',
        code: "import type { RepoShape } from './catalog.base';\nexport declare const catalogRepository: RepoShape;",
        method: 'list',
      }),
      refused({
        name: 'an imported object exported under a new name (Major 1)',
        code: "import { repoObject } from './catalog.base';\nexport const repo = repoObject;",
        method: 'list',
      }),
      refused({
        name: 'another file exported as a namespace (Major 1)',
        code: "export * as base from './catalog.base';",
        method: 'allTeachers',
      }),
      refused({
        name: 'a function re-exported by name from another file (Minor 7)',
        code: "export { allTeachers } from './catalog.base';",
        method: 'allTeachers',
      }),
      {
        name: 'everything another file exports, re-exported (Minor 7)',
        code: withShapes("export * from './catalog.base';"),
        filename: repository,
        errors: [
          { messageId: 'missingGender', data: { name: 'allTeachers', teacher: 'TeacherCard' } },
          { messageId: 'missingGender', data: { name: 'list', teacher: 'TeacherCard' } },
          { messageId: 'missingGender', data: { name: 'list', teacher: 'TeacherCard' } },
        ],
      },

      // A class exposed as a value builds instances, and their methods are read (Major 2).
      refused({
        name: 'a class expression bound to an exported const (Major 2)',
        code: 'export const CatalogRepository = class {\n  list(): TeacherCard[] { return []; }\n};',
        method: 'list',
      }),
      refused({
        name: 'a class exported under an alias (Major 2)',
        code: 'class Impl {\n  list(): TeacherCard[] { return []; }\n}\nexport const CatalogRepository = Impl;',
        method: 'list',
      }),
      refused({
        name: 'a class passed through a mixin (Major 2)',
        code: 'function Traced<B extends new (...args: never[]) => object>(Base: B) { return class extends Base {}; }\nclass Impl {\n  list(): TeacherCard[] { return []; }\n}\nexport const CatalogRepository = Traced(Impl);',
        method: 'list',
      }),

      // Return and exposure shapes (Minor 4).
      refused({
        name: 'a type parameter constrained to a teacher is read through its constraint (Minor 4)',
        code: 'export declare function list<T extends TeacherCard>(map: (row: SubjectRow) => T): Promise<T[]>;',
        method: 'list',
      }),
      refused({
        name: 'a member of a function merged with a namespace (Minor 4)',
        code: 'export function repo(): void {}\nexport namespace repo {\n  export const list = (): TeacherCard[] => [];\n}',
        method: 'list',
      }),
      refused({
        name: 'a factory returning an object of methods (Minor 4)',
        code: 'export function createRepository() {\n  return { list(): TeacherCard[] { return []; } };\n}',
        method: 'list',
      }),
      refused({
        name: 'a factory returning a promise of an unexported class’s instance (Minor 4)',
        code: 'class Impl {\n  list(): TeacherCard[] { return []; }\n}\nexport async function createRepository(): Promise<Impl> { return new Impl(); }',
        method: 'list',
      }),
      refused({
        name: 'a curried function whose returned function returns teachers (Minor 4)',
        code: 'export const list = () => (): TeacherCard[] => [];',
        method: 'list',
      }),

      // The condition under T055, met with T102 once the real client is generated. Prisma resolves
      // every row type of a model to a nameless type, so these are refused by the model the type
      // was built from, never by a name in the code: the first alias deliberately avoids
      // `Teacher…`, which the rule would otherwise match by its name alone.
      refused({
        name: 'the generated teacher_profiles payload under an alias that does not name a teacher (condition under T055)',
        code: [
          "import type { Prisma } from '@prisma/client';",
          'type ProfileCard = Prisma.TeacherProfileGetPayload<{ select: { id: true; bio: true } }>;',
          'export declare function findProfile(id: string): Promise<ProfileCard | null>;',
        ].join('\n'),
        method: 'findProfile',
        teacher: 'TeacherProfile',
      }),
      refused({
        name: 'the generated teacher_profiles payload of a select, inferred with no annotation at all (condition under T055)',
        code: [
          "import type { PrismaClient } from '@prisma/client';",
          'declare const prisma: PrismaClient;',
          'export async function findProfile(id: string) {',
          '  return prisma.teacherProfile.findUnique({ where: { id }, select: { id: true, bio: true } });',
          '}',
        ].join('\n'),
        method: 'findProfile',
        teacher: 'TeacherProfile',
      }),
      refused({
        name: 'the generated teacher_profiles rows of a findMany with no select, inferred with no annotation (condition under T055)',
        code: [
          "import type { PrismaClient } from '@prisma/client';",
          'declare const prisma: PrismaClient;',
          'export async function listProfiles() {',
          '  return prisma.teacherProfile.findMany();',
          '}',
        ].join('\n'),
        method: 'listProfiles',
        teacher: 'TeacherProfile',
      }),
      refused({
        name: 'the generated TeacherProfile model type, whose name Prisma does not keep (condition under T055)',
        code: "export declare function findProfile(id: string): Promise<import('@prisma/client').TeacherProfile | null>;",
        method: 'findProfile',
        teacher: 'TeacherProfile',
      }),

      // T152: a teacher narrowed by a standard-library mapped type is read through the types the
      // alias was instantiated from, whatever the alias is called (PR #47 review n1); and the
      // client's exemption covers its own declarations only, so a member added to it is read
      // like any other (n3).
      refused({
        name: 'the generated TeacherProfile narrowed by Pick under an alias that names no teacher (T152, PR #47 n1)',
        code: [
          "import type { TeacherProfile } from '@prisma/client';",
          "type Card = Pick<TeacherProfile, 'id'>;",
          'export declare function findCard(id: string): Promise<Card | null>;',
        ].join('\n'),
        method: 'findCard',
        teacher: 'TeacherProfile',
      }),
      refused({
        name: 'a plain Teacher interface narrowed by Pick under an alias that names no teacher (T152, PR #47 n1)',
        code: [
          'interface TeacherRecord { readonly id: string; readonly bio: string }',
          "type Card = Pick<TeacherRecord, 'id'>;",
          'export declare function findCard(id: string): Promise<Card[]>;',
        ].join('\n'),
        method: 'findCard',
        teacher: 'TeacherRecord',
      }),
      refused({
        name: 'the generated TeacherProfile narrowed by Omit under an alias that names no teacher (T152, PR #47 n1)',
        code: [
          "import type { TeacherProfile } from '@prisma/client';",
          "type Card = Omit<TeacherProfile, 'id'>;",
          'export declare function findCard(id: string): Promise<Card | null>;',
        ].join('\n'),
        method: 'findCard',
        teacher: 'TeacherProfile',
      }),
      refused({
        name: 'a plain Teacher interface narrowed by Omit under an alias that names no teacher (T152, PR #47 n1)',
        code: [
          'interface TeacherRecord { readonly id: string; readonly bio: string }',
          "type Card = Omit<TeacherRecord, 'id'>;",
          'export declare function findCard(id: string): Promise<Card[]>;',
        ].join('\n'),
        method: 'findCard',
        teacher: 'TeacherRecord',
      }),
      refused({
        name: 'the generated TeacherProfile narrowed by a key-mapped type under an alias that names no teacher (T152, PR #47 n1)',
        code: [
          "import type { TeacherProfile } from '@prisma/client';",
          "type Card = { [K in 'id' | 'bio']: TeacherProfile[K] };",
          'export declare function findCard(id: string): Promise<Card | null>;',
        ].join('\n'),
        method: 'findCard',
        teacher: 'TeacherProfile',
      }),
      refused({
        name: 'a plain Teacher interface narrowed by a key-mapped type under an alias that names no teacher (T152, PR #47 n1)',
        code: [
          'interface TeacherRecord { readonly id: string; readonly bio: string }',
          "type Card = { [K in 'id' | 'bio']: TeacherRecord[K] };",
          'export declare function findCard(id: string): Promise<Card[]>;',
        ].join('\n'),
        method: 'findCard',
        teacher: 'TeacherRecord',
      }),
      refused({
        name: 'a class extending the generated client that carries a teacher, returned under a name that carries none (T152, PR #47 n3)',
        code: [
          "import { PrismaClient } from '@prisma/client';",
          'export declare class Store extends PrismaClient {',
          '  readonly card: TeacherCard;',
          '}',
          'export declare function openStore(): Store;',
        ].join('\n'),
        method: 'openStore',
      }),
      refused({
        name: 'the client joined to a teacher by an intersection (T152, PR #47 n3)',
        code: [
          "import type { PrismaClient } from '@prisma/client';",
          'export declare function openStore(): PrismaClient & { readonly card: TeacherCard };',
        ].join('\n'),
        method: 'openStore',
      }),
    ],
  },
);
