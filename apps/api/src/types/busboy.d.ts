// T024: the shape of `busboy` this API uses, declared here since the package ships no types and
// `@types/busboy` is not a dependency (the parser already serves Nest's multer underneath). Only the
// members `platform/http/multipart.ts` reads are declared; anything else is not reachable.
declare module 'busboy' {
  import type { IncomingHttpHeaders } from 'node:http';
  import type { Readable, Writable } from 'node:stream';

  interface FileInfo {
    readonly filename: string;
    readonly encoding: string;
    readonly mimeType: string;
  }

  interface FieldInfo {
    readonly nameTruncated: boolean;
    readonly valueTruncated: boolean;
    readonly encoding: string;
    readonly mimeType: string;
  }

  interface Limits {
    readonly fieldNameSize?: number;
    readonly fieldSize?: number;
    readonly fields?: number;
    readonly fileSize?: number;
    readonly files?: number;
    readonly parts?: number;
    readonly headerPairs?: number;
  }

  interface Config {
    readonly headers: IncomingHttpHeaders;
    readonly limits?: Limits;
  }

  interface Busboy extends Writable {
    on(event: 'file', listener: (name: string, stream: Readable, info: FileInfo) => void): this;
    on(event: 'field', listener: (name: string, value: string, info: FieldInfo) => void): this;
    on(
      event: 'close' | 'finish' | 'filesLimit' | 'fieldsLimit' | 'partsLimit',
      listener: () => void,
    ): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }

  function busboy(config: Config): Busboy;
  export = busboy;
}
