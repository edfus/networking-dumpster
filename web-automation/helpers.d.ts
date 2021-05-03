/// <reference types="node" />
// import("./node_modules/forward-proxy-tunnel/index.d.ts");
// https://stackoverflow.com/questions/39040108/import-class-in-definition-file-d-ts
import { IncomingMessage } from "http";
import { Transform, Readable } from "stream";
import ProxyTunnel from "forward-proxy-tunnel";

export declare class HTTP extends ProxyTunnel {
  constructor (proxy: string, useProxy: boolean);
  followRedirect (res: IncomingMessage, hostname: string): Promise<IncomingMessage>;
}

export declare class JSONParser extends Transform {
  /**
   * @param maxLength default: Infinity
   */
  constructor (maxLength?: number);
}

export declare class JSONP_Parser extends JSONParser {
  /**
   * @param maxLength default: Infinity
   */
  constructor (callback: string, maxLength?: number);
}

declare function mustStrictEqual (
  actual: any, expect: any,
  emitCallback?: ((err: Error) => string | Error)
): void

declare function logResInfo (res: IncomingMessage): string

declare function series (
  ...func: ((lastResult: any) => result),
  callback: ((err?: Error) => void)
): void

declare function serializeFormData (
  formData: FormData,
  type?: "multipart/form-data" | "application/x-www-form-urlencoded"
) : { body: string | Readable, headers: object }

declare function escapeRegExpSource (source: string): string

declare function md5string (str: string): string;
declare function sha1string (str: string): string;
declare function hmac_md5 (str: string, key: string): string;

export const helper = {
  mustStrictEqual,
  logResInfo, series,
  serializeFormData,
  escapeRegExpSource,
  md5string, hmac_md5,
  sha1string
}