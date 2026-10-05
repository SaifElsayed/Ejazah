// Declarations in a file of their own, for the multi-file cases of T046 (contracts/lint-rules.md).
//
// `gender/require-requester-gender` reads every member a repository file exposes, wherever it is
// declared outside a library: a base class, an imported interface, an imported object, a function
// re-exported from another file. The cases of `tests/lint-plugin/require-requester-gender.spec.ts`
// exist only in memory, and a case can only import what the compiler can read, so these sit on
// disk beside the virtual `catalog.repository.ts` that imports them, as the brand stub does under
// `platform/guards`. No case is ever opened at this path, and nothing here takes a gender, so each
// declaration is refused once a repository file exposes it.

export interface TeacherCard {
  readonly id: string;
}

export declare class BaseRepository<T> {
  all(): Promise<T[]>;
}

export declare class TeacherBase {
  list(): TeacherCard[];
}

export interface RepoShape {
  list(): Promise<TeacherCard[]>;
}

export declare const repoObject: { list(): TeacherCard[] };

export declare function allTeachers(): TeacherCard[];
