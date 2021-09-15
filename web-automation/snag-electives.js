import { Writable, pipeline } from "stream";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { HTTP, __dirname, helper, JSONParser } from "./helpers.js";
import { basename, extname, join } from "path";
import { JSDOM } from "jsdom";
import metadata from "./.secrets/courses-metadata.js";
import { fileURLToPath } from "url";

const __filename = basename(fileURLToPath(import.meta.url));
const dumpPath = join(
  __dirname,
  `./${__filename.substring(0, __filename.length - extname(__filename).length)}.dump`
);

if (!existsSync(dumpPath))
  mkdirSync(dumpPath);

const argvs = process.argv.slice(2);

const httpProxy = extractArg(/^--proxy$/, 1);
const socksProxy = extractArg(/^--socks(5|5h|4a)$/, 1);
const sanitize = extractArg(/^--sanitize$/, 0) !== false;

let proxy;
if(httpProxy) {
  proxy = normalizeProtocol(httpProxy, /^https?/, "http:");
}

if(socksProxy) {
  proxy = normalizeProtocol(socksProxy, /^socks(5|5h|4a)/, "socks5:");
}

if(argvs.length) {
  console.warn("Unrecognized arguments:", argvs);
}

if(proxy) {
  console.info(`Using proxy ${proxy}`)
}

if(sanitize) {
  helper.logResInfo = res => res.statusCode;
}

const http = new HTTP(proxy, proxy !== false);

helper.series(
  getLoginHTML,
  jsdomLogin,
  // ↑ service --JSession--> sso --JSession+ticket--> service --set-cookie-->
  optIn,
  console.info,
  err => {
    if (err) {
      if(sanitize) {
        const safeKeys = ["code", "errno", "message", "stack", "from"];
        Object.keys(err).filter(k => !safeKeys.includes(k.toLowerCase())).forEach(
          key => {
            err[key] = "***";
          }
        )
      }
      throw err;
    }
    process.exitCode = 0;
  }
);

async function getLoginHTML() {
  return http.fetch(metadata.loginURL)
    .then(res =>
      http.followRedirect(res, metadata.loginURL)
        .then(async res => {
          helper.mustStrictEqual(
            res.statusCode,
            200, 
            () => new Error(`getLoginHTML failed. ${helper.logResInfo(res)}`)
          );

          return new Promise((resolve, reject) => {
            const filepath = join(
              dumpPath,
              "./login-jsdom.html"
            );

            pipeline(
              res,
              createWriteStream(filepath),
              err => err ? reject(err) : resolve(filepath)
            );
          });
        })
    )
  ;
}

async function jsdomLogin(filepath) {
  return JSDOM.fromFile(filepath, {
    url: http.lastContext.toString()
  }).then(async dom => {
    const { document, FormData } = dom.window;
    const form = document.forms["fm1"];

    form.querySelector("#username").value = metadata.secrets.username;
    form.querySelector("#password").value = metadata.secrets.password;
    form.querySelector("#rememberMe").checked = false;

    const uri = form.action || 'get';
    const type = form.enctype || 'application/x-www-form-urlencoded';
    const { body, headers } = helper.serializeFormData(new FormData(form), type);

    return http.fetch(
      uri,
      {
        protocol: "https:",
        method: form.method,
        body: body,
        headers: {
          ...headers
        }
      }
    ).then(res => {
      helper.mustStrictEqual(
        res.statusCode,
        302, 
        () => new Error(`jsdomLogin failed. ${helper.logResInfo(res)}`)
      );
      return http.followRedirect(res);
    }).then(res => void res.resume());
  });
}

async function optIn (retriedCount = 0) {
  return http.fetch(
    {
      method: "POST",
      hostname: metadata.hostname,
      path: metadata.optInPath,
      body: metadata.secrets.subjectInfo,
      headers: {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "referrer": `http://${metadata.hostname}`,
        "connection": "keep-alive",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.164 Safari/537.36"
      }
    }
  ).then(async res => {
    if(res.statusCode === 401) {
      await getLoginHTML().then(jsdomLogin);
    }

    helper.mustStrictEqual(
      res.statusCode,
      200,
      () => new Error(`optIn failed. ${helper.logResInfo(res)}`)
    );

    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONParser(),
        new Writable({
          objectMode: true,
          write(result, _, cb) {
            if (Number(result.jg) === -1)
              return cb(
                new Error(sanitize ? "optIn failed" : result.message)
              );
            return cb();
          }
        }),
        async err => {
          if (err) {
            console.error(`#${retriedCount}: ${err.message}`);
            return setTimeout(() => {
              optIn(++retriedCount).then(resolve, reject);
            }, 4000 * Math.random() + 50);
          }
  
          return resolve("done.");
        }
      );
    });
  });
}

function extractArg(matchPattern, offset = 0) {
  for (let i = 0; i < argvs.length; i++) {
    if (matchPattern.test(argvs[i])) {
      const matched = argvs.splice(i, offset + 1);
      return matched.length <= 2 ? matched[offset] : matched.slice(1);
    }
  }
  return false;
}

function normalizeProtocol(uri, matchCertainProtocol, defaultProtocol) {
  if(!uri) return uri;
  if(!/:\\?\/\\?\/$/.test(matchCertainProtocol.source)) {
    matchCertainProtocol = new RegExp(
      matchCertainProtocol.source.replace(/[:\\\/]+$/, "").concat("://")
    );
  }

  return (
    matchCertainProtocol.test(uri)
    ? uri
    : `${defaultProtocol}//${uri.replace(/^.*?:\/\//, "")}`
  );
}