import cookieParser from "set-cookie-parser";
import ProxyTunnel from "forward-proxy-tunnel";
import { request as request_https, Agent as HTTPSAgent } from "https";
import { request as request_http, Agent as HTTPAgent, ClientRequest, IncomingMessage } from "http";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline, Readable, Transform } from "stream";


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

  async fetch (_input, _options, _cb) {
    const { uriObject, options, cb } = this.parseRequestParams(_input, _options, _cb);

    return (
      new Promise((resolve, reject) => {
        const req = (
          this.request.call(this, uriObject, options, cb)
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
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function serializeFormData (formData, type) {
  if(type !== "multipart/form-data") {
    // x-www-form-url-encoded
    const result = []
    for (const [key, value] of formData.entries()) {
      result.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
    return result.join("&");
  } else {
    //TODO
    throw "todo";
  }
}

function getJSONParser() {
  return new Transform({
    readableObjectMode: true,
    transform(chunk, enc, cb) {
      this[Symbol.for("kTmpSource")]
        ? this[Symbol.for("kTmpSource")].push(chunk)
        : this[Symbol.for("kTmpSource")] = [chunk]
        ;
      cb();
    },
    flush(cb) {
      if (!this[Symbol.for("kTmpSource")])
        return cb(new Error("Empty response"));

      const data = new TextDecoder("utf8").decode(
        Buffer.concat(this[Symbol.for("kTmpSource")])
      );

      try {
        cb(null, JSON.parse(data));
      } catch (err) {
        cb(err);
      }
    }
  });
}

export { 
  Cookie, HTTP, __dirname, serializeFormData,
  getJSONParser
};