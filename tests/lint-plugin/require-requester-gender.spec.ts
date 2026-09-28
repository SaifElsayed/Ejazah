// gender/require-requester-gender (R-GENDER-5) against a table of type-checked code (T046).
//
// The fixture proves one method: an exported function returning `Promise<readonly TeacherCard[]>`
// with no gender anywhere in its signature. This table proves the legal counterparts the fixture
// deliberately leaves out — the requester's gender as a parameter, as a property of an options
// object, as an optional parameter, behind an interface — and the ways a teacher list can hide
// from a name match: an alias, an inferred return type, a class method. It also proves what is
// refused on purpose since 2026-09-28: a plain `Gender`, the literal union Prisma emits, a string,
// a plain gender inside an options object — none of them is the requester's gender, because the
// brand is minted only by the request context (T106). And it proves what stays out of reach: a
// method returning something that is not a teacher, a private method, and any file that is not a
// repository. Parameter names are never consulted, so the legal cases use names that say nothing
// about gender and the refused ones use a name that does. The brand is declared the way
// `packages/contracts` will declare it, a `unique symbol` that is never exported, the shape the
// money brand uses (research R-3).

import { loadRule, typeAwareRuleTester, virtualFile } from '../support/rule-tester';

const repository = virtualFile('apps/api/src/modules/catalog/catalog.repository.ts');
const service = virtualFile('apps/api/src/modules/catalog/catalog.service.ts');

const shapes = [
  "type Gender = 'male' | 'female';",
  'declare const requesterGenderBrand: unique symbol;',
  'type RequesterGender = Gender & { readonly [requesterGenderBrand]: true };',
  'interface TeacherCard { readonly id: string }',
  'interface SubjectRow { readonly id: string }',
].join('\n');

function withShapes(code: string): string {
  return `${shapes}\n${code}`;
}

typeAwareRuleTester().run(
  'gender/require-requester-gender',
  loadRule('require-requester-gender.js'),
  {
    valid: [
      {
        name: 'the requester’s gender as a parameter',
        code: withShapes(
          'export declare function listTeachers(who: RequesterGender, subjectId: string): Promise<readonly TeacherCard[]>;',
        ),
        filename: repository,
      },
      {
        name: 'the requester’s gender inside an options object',
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
        name: 'an optional requester’s gender still takes it',
        code: withShapes(
          'export declare function findTeacher(id: string, g?: RequesterGender): Promise<TeacherCard | null>;',
        ),
        filename: repository,
      },
      {
        name: 'the brand survives a nullable and a mapped type',
        code: withShapes(
          'export declare function findTeacher(options: Readonly<{ by: RequesterGender | null }>): Promise<TeacherCard | null>;',
        ),
        filename: repository,
      },
      {
        name: 'a method returning something other than teachers',
        code: withShapes('export declare function listSubjects(): Promise<readonly SubjectRow[]>;'),
        filename: repository,
      },
      {
        name: 'a private and a #private method are not callable from a student path',
        code: withShapes(
          'export class CatalogRepository {\n  private all(): TeacherCard[] { return []; }\n  #every(): TeacherCard[] { return []; }\n}',
        ),
        filename: repository,
      },
      {
        name: 'a function that is not exported',
        code: withShapes(
          'function all(): TeacherCard[] { return []; }\nexport const count = (): number => all().length;',
        ),
        filename: repository,
      },
      {
        name: 'a file that is not a repository',
        code: withShapes('export declare function listTeachers(): Promise<TeacherCard[]>;'),
        filename: service,
      },
    ],
    invalid: [
      {
        name: 'the fixture’s shape: a promise of a readonly teacher list and no gender',
        code: withShapes(
          'export declare function listTeachersForSubject(subjectId: string): Promise<readonly TeacherCard[]>;',
        ),
        filename: repository,
        errors: [
          {
            messageId: 'missingGender',
            data: { name: 'listTeachersForSubject', teacher: 'TeacherCard' },
          },
        ],
      },
      {
        name: 'a parameter named for gender but typed as a string',
        code: withShapes(
          'export declare function listTeachers(requesterGender: string): Promise<TeacherCard[]>;',
        ),
        filename: repository,
        errors: [
          { messageId: 'missingGender', data: { name: 'listTeachers', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'a plain Gender parameter, which could be the teacher’s or the client’s',
        code: withShapes(
          'export declare function listTeachers(requesterGender: Gender, subjectId: string): Promise<readonly TeacherCard[]>;',
        ),
        filename: repository,
        errors: [
          { messageId: 'plainGender', data: { name: 'listTeachers', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'the literal union Prisma emits for enum Gender is a plain gender too',
        code: withShapes(
          "export declare function findTeacher(id: string, requesterGender: 'female' | 'male'): Promise<TeacherCard | null>;",
        ),
        filename: repository,
        errors: [
          { messageId: 'plainGender', data: { name: 'findTeacher', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'a plain Gender inside an options object',
        code: withShapes(
          'export declare function listTeachers(options: { readonly requesterGender: Gender; readonly subjectId: string }): Promise<TeacherCard[]>;',
        ),
        filename: repository,
        errors: [
          { messageId: 'plainGender', data: { name: 'listTeachers', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'an optional plain Gender is still plain',
        code: withShapes(
          'export declare function findTeacher(id: string, requesterGender?: Gender): Promise<TeacherCard | null>;',
        ),
        filename: repository,
        errors: [
          { messageId: 'plainGender', data: { name: 'findTeacher', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'an alias hiding the teacher list is resolved through the checker',
        code: withShapes(
          'type Roster = readonly TeacherCard[];\nexport declare function roster(subjectId: string): Promise<Roster>;',
        ),
        filename: repository,
        errors: [{ messageId: 'missingGender', data: { name: 'roster', teacher: 'TeacherCard' } }],
      },
      {
        name: 'an inferred return type from an exported arrow',
        code: withShapes(
          'declare const rows: TeacherCard[];\nexport const everyone = async () => rows;',
        ),
        filename: repository,
        errors: [
          { messageId: 'missingGender', data: { name: 'everyone', teacher: 'TeacherCard' } },
        ],
      },
      {
        name: 'a nullable single teacher',
        code: withShapes(
          'export async function byId(id: string): Promise<TeacherCard | null> { return id === "" ? null : { id }; }',
        ),
        filename: repository,
        errors: [{ messageId: 'missingGender', data: { name: 'byId', teacher: 'TeacherCard' } }],
      },
      {
        name: 'a public class method',
        code: withShapes(
          'export class CatalogRepository {\n  async search(term: string): Promise<TeacherCard[]> { return term === "" ? [] : []; }\n}',
        ),
        filename: repository,
        errors: [{ messageId: 'missingGender', data: { name: 'search', teacher: 'TeacherCard' } }],
      },
    ],
  },
);
