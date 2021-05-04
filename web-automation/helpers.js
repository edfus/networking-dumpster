import cookieParser from "set-cookie-parser";
import ProxyTunnel from "forward-proxy-tunnel";
import { SocksClient } from "socks";

import { request as request_https, Agent as HTTPSAgent } from "https";
import { request as request_http, Agent as HTTPAgent, ClientRequest, IncomingMessage } from "http";
import { connect as tlsConnect } from "tls";
import { basename, dirname } from "path";
import { fileURLToPath } from "url";
import { inspect } from "util";
import { ok as assert, strictEqual } from "assert";
import { Readable, Transform } from "stream";
import { createHash, createHmac, randomBytes } from "crypto";
import querystring from "querystring";


class Cookie {
  constructor() {
    const regexMap = new Map();
    const cache = new Map();  //NOTE possible memory leak
    this.storage = new class CookieMap extends Map {
      // match cookie.domain, cookie.path, cookie.secure
      get(domainWithPath, isInSecureContext) {
        let cachedPattern = cache.get(domainWithPath);
        if (cachedPattern)
          return this.serialize(super.get(cachedPattern.source), isInSecureContext);

        for (const matchSource of super.keys()) {
          let matchPattern = regexMap.get(matchSource);
          if (!matchPattern) {
            matchPattern = new RegExp(matchSource, "i");
            regexMap.set(matchSource, matchPattern);
          }

          if (matchPattern.test(domainWithPath)) {
            return this.serialize(super.get(matchSource), isInSecureContext);
          }
        }
        return "";
      }

      // handle cookie.maxAge || cookie.expires
      serialize(cookiesArray, inSecureContext) {
        if (!Array.isArray(cookiesArray))
          return "";

        return cookiesArray.reduce(
          (result, currentValue, i) => {
            if (currentValue.secure && !inSecureContext)
              return result;
            if (!isNaN(currentValue.expires) && currentValue.expires <= Date.now()) {
              cookiesArray.splice(i, 1);
              return result;
            }
            result.push(currentValue.value);
            return result;
          },
          []
        ).join("; ");
      }

      domain2regexSrc(domainWithPath) {
        if (domainWithPath.endsWith("/"))
          domainWithPath = domainWithPath.substring(0, domainWithPath.length - 1);

        domainWithPath = domainWithPath
          .trim()
          .toLowerCase()
          .replace(/(\.)/g, "\\$1")
          .replace(/\[|\]/g, "")
          ;
        return `^([a-z0-9.-]+\.)?${domainWithPath}`;
      }

      add(domainWithPath, value) {
        const matchSource = this.domain2regexSrc(domainWithPath);

        const cookiesArray = super.get(matchSource);
        if (Array.isArray(cookiesArray))
          cookiesArray.push(value);
        else super.set(matchSource, [value]);
      }
    };
  }

  applyTo(request) {
    if (request instanceof ClientRequest) {
      const cookie = this.storage.get(
        request.host.concat(request.path),
        request.protocol === "https:"
      );
      request.setHeader("cookie", cookie);
      return request;
    }
    console.warn(`Received non-ClientRequest ${request}`);
    return request;
  }

  /**
   * @param {string | URL | ClientRequest} input 
   * @param {IncomingMessage} response 
   * @returns boolean
   */
  add(input, response) {
    if (!(response instanceof IncomingMessage)) {
      console.warn(`Received non-IncomingMessage ${response}`);
      return false;
    }

    const cookies = cookieParser.parse(
      response, {
      decodeValues: false
    }
    );

    const hostname = input.hostname || input.host || input;
    cookies.forEach(cookie => {
      if (cookie.domain)
        cookie.domain = cookie.domain.replace(/^\./, "");
      this.storage.add(
        (cookie.domain || hostname).concat(cookie.path || "/"),
        {
          value: `${cookie.name}${cookie.value ? "=".concat(cookie.value) : ""}`,
          expires: cookie.maxAge ? Date.now() + cookie.maxAge * 1000 : Number(cookie.expires) || NaN,
          secure: cookie.secure || false
          // sameSite: ""
        }
      );
    });
    return true;
  }
}

class HTTP {
  cookie = new Cookie();
  lastContext = new URL("http://localhost");
  defaultHeader = {
    "Accept": "*/*",
    "User-Agent": `node ${process.version}`
  };

  httpAgent = new HTTPAgent({ keepAlive: true });
  httpsAgent = new HTTPSAgent({ keepAlive: true });

  constructor(proxy, useProxy) {
    if (proxy && useProxy) {
      const [protocol, host] = proxy.split("://");

      switch (protocol) {
        case "http":
        case "https":
          this.proxy = new ProxyTunnel(proxy, { agentOptions: { keepAlive: true } });
          this._request = this.proxy.request.bind(this.proxy);
          break;
        case "socks4":
        case "socks4a":
        case "socks5":
        case "socks5h":
          const version = /^socks(\d)/.exec(protocol)[1];
          const { hostname, port } = new URL("http://".concat(host));

          this.socksConnectOptions = {
            proxy: {
              host: hostname,
              port: Number(port),
              type: Number(version)
            },
            command: "connect"
          };

          const createConnection = ({ host, port }, cb) => {
            SocksClient.createConnection(
              {
                ...this.socksConnectOptions,
                destination: {
                  host, port
                }
              },
              (err, info) => cb(err, info?.socket)
            );
          };

          const createSecureConnection = (options, cb) => {
            const { host: hostname, port } = options;

            return createConnection(
              options,
              (err, socket) => {
                if (err)
                  return cb(err);

                return cb(null, tlsConnect({
                  host: hostname,
                  servername: hostname,
                  port: port,
                  socket: socket
                }));
              }
            );
          };

          this.httpAgent.createConnection = createConnection;
          this.httpsAgent.createConnection = createSecureConnection;
          break;
        default:
          throw new TypeError(`unknown protocol prefix ${protocol} specified.`);
      }
    }
  }

  _request(uriObject, options, cb) {
    options.headers = {
      ...this.defaultHeader,
      ...options.headers
    };
    options.agent = (
      "agent" in options
        ? options.agent
        : uriObject.protocol === "https:"
          ? this.httpsAgent
          : this.httpAgent
    );
    return (
      uriObject.protocol === "https:"
        ? request_https(uriObject, options, cb)
        : request_http(uriObject, options, cb)
    );
  }

  parseRequestParams(input, options, cb) {
    if (typeof input === "string") {
      if (input.startsWith("/")) // from root
        input = new URL(input, this.lastContext.origin);
      if (/\.+\//.test(input)) // relative ../ | ./
        input = new URL(input, `${this.lastContext.protocol}//${this.lastContext.host}${this.lastContext.pathname}`);
    }

    const params = ProxyTunnel.prototype.parseRequestParams(input, options, cb);

    this.lastContext = params.uriObject;

    return params;
  }

  request(_input, _options, _cb) {
    const { uriObject, options, cb } = this.parseRequestParams(_input, _options, _cb);

    const cookie = this.cookie.storage.get(
      uriObject.hostname.concat(uriObject.pathname),
      uriObject.protocol === "https:"
    );

    const req = this._request(uriObject, options, cb);

    if(cookie) {
      req.setHeader("cookie", cookie); // returns undefined in 12.9.0
    }

    return req.prependOnceListener("response", res => this.cookie.add(uriObject.hostname, res));
  }

  async fetch(_input, _options) {
    return ProxyTunnel.prototype.fetch.call(this, _input, _options);
  }

  async followRedirect(res, host = this.lastContext.host) {
    if (![301, 302, 303, 307, 308].includes(res.statusCode))
      return res;

    res.resume();

    if (!res.headers.location)
      throw new Error(logResInfo(res));

    // URL
    if (/^https?:/.test(res.headers.location)) {
      const uriObject = new URL(res.headers.location);

      return this.fetch(uriObject).then(res => this.followRedirect(res, uriObject.host));
    }

    // URI
    return (
      this.fetch({ host, path: res.headers.location })
          .then(res => this.followRedirect(res, host))
    );
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const kOnceResume = Symbol("onceResume");
const kReading = Symbol("reading");
const kReadNext = Symbol("readNext");
const kChunkBuffer = Symbol("chunkBuffer");

class FormDataStream extends Readable {
  lineBreak = "\r\n";
  defaultContentType = "text/plain";
  defaultStreamContentType = "application/octet-stream";
  [kChunkBuffer] = "";

  constructor(iterator) {
    super();
    this.iterator = iterator;
    this.boundary = this.generateBoundary();
  }

  async readNext () {
    this[kReading] = true;
    const boundary = this.boundary;
    const { done, value } = this.iterator.next();
    
    if(done) {
      this.push(`--${boundary}--`);
      this[kReading] = false;
      return this.push(null);
    }

    const [name, content] = value;
    
    this.pushChunk(`--${boundary}`);
    this.pushChunk(this.lineBreak);

    this.pushChunk(`Content-Disposition: form-data; name="${encodeURIComponent(name)}"`);
    // Readable or { source, filename, contentType, contentTransferEncoding }
    if(content instanceof Readable || content.source) {
      const source = content.source || content;
      const filename = content.filename || basename(content.path || "") || name;
      
      this.pushChunk(`; filename="${encodeURIComponent(filename)}"`);
      this.pushChunk(this.lineBreak);

      await this.streamFileField(source, content.contentType);
    } else {
      this.pushChunk(this.lineBreak);
      // Array
      if(Array.isArray(content)) {
        let filenameIndex = 0;
        const subBoundary = this.generateBoundary();
        this.pushChunk(`Content-Type: multipart/mixed; boundary=${subBoundary}`);
        this.pushChunk(this.lineBreak.repeat(2));

        /**
         * source: string | Buffer | Readable,
         * filename: string,
         * contentType: string,
         * contentTransferEncoding: string
         */
        for (const file of content) {
          this.pushChunk(`--${subBoundary}`);
          this.pushChunk(this.lineBreak);

          if(file instanceof Readable) {
            const filename = basename(file.path || "") || `${name}-${filenameIndex++}`;
            this.pushChunk(
              `Content-Disposition: file; filename="${
                encodeURIComponent(filename)
              }"`
            );
            this.pushChunk(this.lineBreak);
            await this.streamFileField(file);
            continue;
          }

          this.pushChunk(
            `Content-Disposition: file; filename="${
              encodeURIComponent(file.filename || `${name}-${filenameIndex++}`)
            }"`
          );
          this.pushChunk(this.lineBreak);
          await this.streamFileField(file.source, file.contentType);
        }

        this.pushChunk(`--${subBoundary}--`);
        this.pushChunk(this.lineBreak);
      } else {
        // buffer or string
        await this.streamFileField(content);
      }
    }

    if(this[kReadNext]) {
      this[kReadNext] = false;
      return this.readNext();
    } else {
      return this[kReading] = false;
    }
  }

  async onceResume () {
    if(this[kReadNext]) {
      this[kReadNext] = false;
      return Promise.resolve();
    }

    if(this[kOnceResume]?.promise) {
      return this[kOnceResume].promise;
    } else {
      this[kOnceResume] = {};
      const promise = new Promise((resolve, reject) => {
        this[kOnceResume].resolve = () => {
          this[kOnceResume] = null;
          return resolve();
        };
        this[kOnceResume].reject = reject;
      });
      this[kOnceResume].promise = promise;
      return promise;
    }
  }

  _destroy(err, cb) {
    if(this[kOnceResume]?.reject) {
      this[kOnceResume].reject(err);
    }
    return cb(err);
  }

  _read(size) {
    if(this[kReading]) {
      if(this[kOnceResume]?.resolve) {
        return this[kOnceResume].resolve();
      } else {
        /**
         * Once the readable._read() method has been called,
         * it will not be called again until more data is pushed
         * through the readable.push()` method. 
         */
        return this[kReadNext] = true;
      }
    } else {
      return this.readNext();
    }
  }

  /**
   * https://github.com/form-data/form-data/blob/master/lib/form_data.js
   * Optimized for boyer-moore parsing
   */
  generateBoundary() {
    return "-".repeat(16).concat(randomBytes(20).toString("base64"));
  }

  pushChunk (chunk) {
    this[kChunkBuffer] = this[kChunkBuffer].concat(chunk);
  }

  flushChunks (encoding) {
    this.push(this[kChunkBuffer], encoding);
    this[kChunkBuffer] = "";
  }

  async streamFileField (file, contentType) {
    assert(file);
  
    if(file.length) { // string or Buffer 
      this.pushChunk(`Content-Type: ${contentType || this.defaultContentType}`);
      this.pushChunk(this.lineBreak.repeat(2));
      this.flushChunks();
      this.push(file);
      return this.push(this.lineBreak);
    }

    if(!(file instanceof Readable))
      throw new Error(`Received non-Readable stream ${file}`);

    this.pushChunk(`Content-Type: ${contentType || this.defaultStreamContentType}`);
    this.pushChunk(this.lineBreak.repeat(2));  
    this.flushChunks();

    for await (const chunk of this.readStream(file)) {
      if(this.push(chunk) === false) {
        await this.onceResume();
      }
    }

    this.push(this.lineBreak);
  }

  async * readStream (stream) {
    let chunk;
    while (stream.readable) {
      await new Promise((resolve, reject)=> {
        stream.once("error", reject)
            .once("end", resolve)
            .once("readable", () => {
              stream.removeListener("end", resolve);
              stream.removeListener("error", reject);
              return resolve();
            });
      });

      if(!stream.readable) break;

      while (null !== (chunk = stream.read())) {
        yield chunk;
      }
    }
  }
}

/**
 * Previously, it was recommended that senders use a Content-Transfer-
   Encoding encoding (such as "quoted-printable") for each non-ASCII
   part of a multipart/form-data body because that would allow use in
   transports that only support a "7bit" encoding.  This use is
   deprecated for use in contexts that support binary data such as HTTP.
   Senders SHOULD NOT generate any parts with a Content-Transfer-
   Encoding header field.
 * https://tools.ietf.org/html/rfc7578
 * https://github.com/nodejs/node/blob/v16.0.0/lib/querystring.js
 * @param { FormData } formData an object implemented FormData interface
 * @param {"multipart/form-data" | "application/x-www-form-urlencoded"} type 
 * @returns { body: string | Readable, headers: object }
 */
function serializeFormData(formData, type = formData?.type) {
  const iterator = (
    typeof formData.entries === "function"
    ? formData.entries()
    : formData[Symbol.iterator]
      ? formData[Symbol.iterator]()
      : Object.entries(formData)[Symbol.iterator]()
  );
  
  switch (type) {
    case "multipart/form-data":
      const formDataStream = new FormDataStream(iterator);
      return {
        body: formDataStream,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${formDataStream.boundary}; charset=UTF-8`
        }
      }
    default:
      type && console.warn(`Unknown type ${type} will be treated as application/x-www-form-urlencoded.`)
    case "application/x-www-form-urlencoded":
      let result = [];
      for (const [key, value] of iterator) {
        const escapedKey = escape(key);
        if(Array.isArray(value)) {
          if(value.length)
            result = result.concat(value.map(v => `${escapedKey}=${escape(v)}`));
        } else {
          result.push(`${escapedKey}=${escape(value)}`);
        }
      }

      return {
        body: result.join("&"),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        }
      };
  }
}

function escape(value) {
  switch (typeof value) {
    case "string":
      return (value.length ? querystring.escape(value) : "");
    case "number":
      if(isFinite(value))
      /**
       * Values >= 1e21 automatically switch to scientific notation which requires
       * escaping due to the inclusion of a '+' in the output
       */
        return (Math.abs(value) < 1e21 ? String(value) : querystring.escape(String(value)));
      return "";
    case "bigint":
      return String(value);
    case "boolean":
      return value ? "true" : "false";
    default:
      return "";
  }
}

class JSONParser extends Transform {
  constructor(maxLength = Infinity) {
    super({ readableObjectMode: true });
    this[Symbol.for("kLength")] = 0;
    this[Symbol.for("kMaxLength")] = maxLength;
    this[Symbol.for("kTmpSource")] = [];
  }

  _transform(chunk, enc, cb) {
    this[Symbol.for("kTmpSource")].push(chunk);
    if (this[Symbol.for("kLength")] += chunk.length > this[Symbol.for("kMaxLength")])
      return cb(new RangeError(`JSONParser: maxLength ${maxLength} reached.`));
    return cb();
  }

  _flush(cb) {
    if (!this[Symbol.for("kTmpSource")])
      return cb(new Error("Empty response"));

    const data = new TextDecoder("utf8").decode(
      Buffer.concat(this[Symbol.for("kTmpSource")])
    );

    try {
      return cb(null, JSON.parse(data));
    } catch (err) {
      return cb(err);
    }
  }
}

let escapeRegEx;
function escapeRegExpSource(str) {
  if(!escapeRegEx) {
    escapeRegEx = new RegExp(
      "(" + "[]\^$.|?*+(){}".split("").map(c => "\\".concat(c)).join("|") + ")",
      "g"
    );
  }
  return str.replace(escapeRegEx, "\\$1");
}

class JSONP_Parser extends JSONParser {
  constructor(callback, maxLength = 30000) {
    super(maxLength);
    this.callback = escapeRegExpSource(callback);
  }

  _flush(cb) {
    if (!this[Symbol.for("kTmpSource")])
      return cb(new Error("Empty response"));

    const data = new TextDecoder("utf8").decode(
      Buffer.concat(this[Symbol.for("kTmpSource")])
    )
      .replace(
        new RegExp(`^${this.callback}\\s?\\(`),
        ""
      )
      .replace(/\)[\s;]*$/, "");

    try {
      return cb(null, JSON.parse(data));
    } catch (err) {
      return cb(err);
    }
  }
}

function series(...argv) {
  const callback = argv[argv.length - 1];

  let ret;
  (async () => {
    for (let i = 0; i < argv.length - 1; i++) {
      const func = argv[i];

      try {
        ret = await func(ret);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(err);
        error.from = [
          `This exception was thrown from`,
          func.name.concat(","),
          "\nwhich is the",
          String(i + 1).concat(["st", "nd", "rd"][i] || "th"),
          "child of",
          `[${argv.slice(0, argv.length - 1).map(f => f.name).join(", ")}]`
        ].join(" ");
        return callback(error);
      }
    }
    return callback(null);
  })();
}

function logResInfo(res) {
  return (
    "\n\nThe response headers: ".concat(inspect(res.headers)).concat(
      `\n\nThe response status: ${res.statusCode} ${res.statusMessage}\n`
    )
  );
}

function mustStrictEqual(actual, expect, emitCallback) {
  try {
    strictEqual(actual, expect);
  } catch (err) {
    throw typeof emitCallback === "function" ? emitCallback(err) : err;
  }
}

function hmac_md5(string, key) {
  return createHmac("md5", key).update(string).digest("hex");
}

function md5string(string) {
  return createHash("md5").update(string).digest("hex");
}

function sha1string(string) {
  return createHash("sha1").update(string).digest("hex");
}

export const helper = {
  serializeFormData, series, md5string, sha1string, hmac_md5,
  mustStrictEqual, logResInfo, escapeRegExpSource
};

export {
  Cookie, HTTP, __dirname, JSONParser, JSONP_Parser,
};