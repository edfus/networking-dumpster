import cookieParser from "set-cookie-parser";
import ProxyTunnel from "forward-proxy-tunnel";

import { request as request_https, Agent as HTTPSAgent } from "https";
import { request as request_http, Agent as HTTPAgent, ClientRequest, IncomingMessage } from "http";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { inspect } from "util";
import { strictEqual } from "assert";
import { pipeline, Readable, Transform } from "stream";
import { createHash, createHmac } from "crypto";


class Cookie {
  constructor () {
    const regexMap = new Map();
    const cache = new Map();  //NOTE possible memory leak
    this.storage = new class CookieMap extends Map {
      get (domainWithPath, isInSecureContext) {
        let cachedPattern = cache.get(domainWithPath);
        if(cachedPattern)
          return this.serialize(super.get(cachedPattern.source), isInSecureContext);

        for (const matchSource of super.keys()) {
          let matchPattern = regexMap.get(matchSource);
          if(!matchPattern) {
            matchPattern = new RegExp(matchSource, "i");
            regexMap.set(matchSource, matchPattern);
          }

          if(matchPattern.test(domainWithPath)) {
            return this.serialize(super.get(matchSource), isInSecureContext);
          }
        }
        return "";
      }

      serialize (cookiesArray, inSecureContext) {
        if(!Array.isArray(cookiesArray))
          return "";

        return cookiesArray.reduce(
          (result, currentValue, i) => {
            if(currentValue.secure && !inSecureContext)
              return result;
            if(!isNaN(currentValue.expires) && currentValue.expires <= Date.now()) {
              cookiesArray.splice(i, 1);
              return result;
            }
            result.push(currentValue.value);
            return result;
          },
          []
        ).join("; ");
      }

      domain2regexSrc (domainWithPath) {
        if(domainWithPath.endsWith("/"))
          domainWithPath = domainWithPath.substring(0, domainWithPath.length - 1);
        
        domainWithPath = domainWithPath
                          .trim()
                          .toLowerCase()
                          .replace(/(\.)/g, "\\$1")
                          .replace(/\[|\]/g, "")
        ;
        return `^([a-z0-9.-]+\.)?${domainWithPath}`;
      }

      add (domainWithPath, value) {
        const matchSource = this.domain2regexSrc(domainWithPath);

        const cookiesArray = super.get(matchSource);
        if(Array.isArray(cookiesArray))
          cookiesArray.push(value);
        else super.set(matchSource, [value]);
      }
    }
  }

  applyTo (request) {
    if(request instanceof ClientRequest) {
      const cookie = this.storage.get(
        request.host.concat(request.path),
        request.protocol === "https:"
      );
      request.setHeader("cookie", cookie);
      return request;
    }
    return void 0;
  }

  add (request, response) {
    if(response instanceof IncomingMessage) { // response
      const cookies = cookieParser.parse(
        response,
        {
          decodeValues: false
        }
      );

      const hostname = request.host || request;
      cookies.forEach(cookie => {
        if(cookie.domain)
          cookie.domain = cookie.domain.replace(/^\./, "")
        this.storage.add(
          (cookie.domain || hostname).concat(cookie.path || "/"),
          {
            value: `${cookie.name}${cookie.value ? "=".concat(cookie.value) : ""}`,
            expires: cookie.maxAge ? Date.now() + cookie.maxAge * 1000 : Number(cookie.expires) || NaN,
            secure: cookie.secure || false
            // sameSite: ""
          }
        )
      });
      return true;
    }
  
    return false;
  }
}

class HTTP {
  constructor (proxy, useProxy) {
    if(proxy && useProxy) {
      this.proxy = new ProxyTunnel(proxy);
      this._request = this.proxy.request.bind(this.proxy);
      process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
    }
    this.cookie = new Cookie();
    this.lastContext = new URL("http://localhost");

    this.defaultHeader = {
      "Accept": "*/*",
      "User-Agent": `node ${process.version}`
    };

    this.httpAgent = new HTTPAgent({
      keepAlive: true
    });

    this.httpsAgent = new HTTPSAgent({
      keepAlive: true
    })
  }

  _request (uriObject, options, cb) {
    options.headers = {
      ...this.defaultHeader,
      ...options.headers
    }
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

  parseRequestParams (input, options, cb) {
    if(typeof input === "string") {
      if(/\.\/|\//.test(input)) // path - / | ./
        input = new URL(input, `${this.lastContext.protocol}//${this.lastContext.host}`)
    }

    const params = ProxyTunnel.prototype.parseRequestParams(input, options, cb);

    this.lastContext = params.uriObject;

    return params;
  }

  request (_input, _options, _cb) {
    const { uriObject, options, cb } = this.parseRequestParams(_input, _options, _cb);

    const cookie = this.cookie.storage.get(
      uriObject.hostname.concat(uriObject.pathname),
      uriObject.protocol === "https:"
    );

    return this._request(uriObject, options, cb)
      .setHeader("cookie", cookie) // returns undefined in 12.9.0
      .prependOnceListener("response", res => this.cookie.add(uriObject.hostname, res))
    ;
  }

  async fetch (_input, _options) {
    const { uriObject, options } = this.parseRequestParams(_input, _options);

    return (
      new Promise((resolve, reject) => {
        const req = (
          this.request.call(this, uriObject, options)
            .once("response", resolve)
            .once("error", err => {
              if (req.reusedSocket && err.code === 'ECONNRESET') {
                req.removeListener("response", resolve);
                this.fetch.apply(this, arguments).then(resolve, reject);
              } else {
                return reject(err);
              }
            })
        );
        const body = options.body || options.data;
        if(body instanceof Readable) {
          pipeline(
            body,
            req,
            err => err && reject(err) 
          )
        } else {
          req.end(body);
        }
      })
    );
  }

  async followRedirect(res, hostname) {
    if (![301, 302, 303, 307, 308].includes(res.statusCode))
      return res;
  
    res.resume();
  
    if (!res.headers.location)
      throw new Error(logResInfo(res));
  
    let fetchPromise;
  
    if (/https?:/.test(res.headers.location)) {
      fetchPromise = this.fetch(res.headers.location);
    } else {
      fetchPromise = this.fetch({
        hostname: hostname,
        path: res.headers.location
      });
    }
  
    return fetchPromise.then(res => this.followRedirect(res, hostname));
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function serializeFormData (formData, type) {
  const iterator = formData.entries ? formData.entries() : Object.entries(formData);
  if(type !== "multipart/form-data") {
    // x-www-form-url-encoded
    const result = [];
    for (const [key, value] of iterator) {
      result.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
    return result.join("&");
  } else {
    //TODO
    throw "todo";
  }
}

class JSONParser extends Transform {
  constructor (maxLength = Infinity) {
    super({ readableObjectMode: true });
    this[Symbol.for("kLength")] = 0;
    this[Symbol.for("kMaxLength")] = maxLength;
    this[Symbol.for("kTmpSource")] = [];
  }

  _transform (chunk, enc, cb) {
    this[Symbol.for("kTmpSource")].push(chunk);
    if(this[Symbol.for("kLength")] += chunk.length > this[Symbol.for("kMaxLength")])
      return cb(new RangeError(`JSONParser: maxLength ${maxLength} reached.`));
    return cb();
  }

  _flush (cb) {
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

const escapeRegEx = new RegExp(
  "(" + "[]\^$.|?*+(){}".split("").map(c => "\\".concat(c)).join("|") + ")",
  "g"
);

function escapeRegExpSource (str) {
  return str.replace(escapeRegEx, "\\$1")
}

class JSONP_Parser extends JSONParser {
  constructor (callback, maxLength = 30000) {
    super(maxLength);
    this.callback = escapeRegExpSource(callback);
  }

  _flush (cb) {
    if (!this[Symbol.for("kTmpSource")])
      return cb(new Error("Empty response"));

    const data = new TextDecoder("utf8").decode(
      Buffer.concat(this[Symbol.for("kTmpSource")])
    )   
      .replace(
        new RegExp(`^${this.callback}\\s?\\(`),
        ""
      )
      .replace(/\)[\s;]*$/, "")

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
        return callback(err instanceof Error ? err : new Error(err));
      }
    }
    return callback(null);
  })();
}

function logResInfo (res) {
  return (
    "\n\nThe response headers: ".concat(inspect(res.headers)).concat(
      `\n\nThe response status: ${res.statusCode} ${res.statusMessage}\n`
    )
  );
}

function mustStrictEqual (actual, expect, emitCallback) {
  try {
    strictEqual(actual, expect)
  } catch (err) {
    throw typeof emitCallback === "function" ? emitCallback(err) : err;
  }
}

function hmac_md5(string, key) {
  return createHmac("md5", key).update(string).digest("hex");
}

function md5string(string) {
  return createHash("md5").update(string).digest("hex")
}

function sha1string(string) {
  return createHash("sha1").update(string).digest("hex")
}

export const helper = {
  serializeFormData, series, md5string, sha1string, hmac_md5,
  mustStrictEqual, logResInfo, escapeRegExpSource
}

export { 
  Cookie, HTTP, __dirname, JSONParser, JSONP_Parser,
};