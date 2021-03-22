import { Writable, pipeline } from "stream";
import { inspect } from "util";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { HTTP, __dirname, serializeFormData, getJSONParser } from "./helpers.js";
import { strictEqual } from "assert";
import { basename, extname, join } from "path";
import { JSDOM } from "jsdom";
import { IncomingMessage } from "http";
import metadata from "./.secrets/cc-metadata.js";
import { stringify } from "querystring";

const __filename = basename(import.meta.url);
const dumpPath = join(
  __dirname,
  `./${__filename.substring(0, __filename.length - extname(__filename).length)}.dump`
);

if (!existsSync(dumpPath))
  mkdirSync(dumpPath);

const useProxy = false;
const http = new HTTP("http://localhost:8888", useProxy);

series(
  getLoginHTML,
  jsdomLogin,
  // ↑ service --JSession--> sso --JSession+ticket--> service --set-cookie-->
  getFormModuleId,
  createForm,
  sendData,
  console.info,
  err => {
    if (err) throw err;
    process.exitCode = 0;
  }
);

async function getLoginHTML() {
  return http.fetch({
    hostname: metadata.hostname,
    path: metadata.loginPath
  })
    .then(res =>
      followRedirect(res)
        .then(async res => {
          mustStrictEqual(
            res.statusCode,
            200, 
            () => `getLoginHTML failed. ${logResInfo(res)}`
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
  }).then(dom => {
    const { document, FormData } = dom.window;
    const form = document.forms["fm1"];

    form.querySelector("#username").value = metadata.secrets.username;
    form.querySelector("#password").value = metadata.secrets.password;
    form.querySelector("#rememberMe").checked = false;

    const uri = form.action || 'get';
    const type = form.enctype || 'application/x-www-form-urlencoded';

    return http.fetch(
      uri,
      {
        method: form.method,
        body: serializeFormData(new FormData(form), type),
        headers: {
          "Content-type": type
        }
      }
    ).then(res => {
      mustStrictEqual(
        res.statusCode,
        200, 
        () => `jsdomLogin failed. ${logResInfo(res)}`
      );
      return followRedirect(res);
    }).then(res => void res.resume());
  });
}

async function getFormModuleId() {
  let query = "?zt=00&id=";
  const resultStoreFilepath = join(
    dumpPath,
    `./edit-query-result-${new Date().toLocaleDateString().replace(/\/|\\/g, "-")
    }.json`
  );

  let source;

  if (existsSync(resultStoreFilepath)) {
    source = createReadStream(resultStoreFilepath);
  } else {
    source = await http.fetch({
      hostname: metadata.hostname,
      path: metadata.getFormModuleIdPath,
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01"
      },
      method: "POST"
    });

    mustStrictEqual(
      source.statusCode,
      200, 
      () => `getFormModuleId failed. ${logResInfo(source)}`
    );
  }

  return new Promise((resolve, reject) => {
    pipeline(
      source,
      getJSONParser(),
      new Writable({
        objectMode: true,
        write(result, _, cb) {
          if (!result.isSuccess)
            return cb(new Error(result.msg));

          query += result.module; //

          if (source instanceof IncomingMessage) {
            createWriteStream(resultStoreFilepath)
              .end(JSON.stringify(result), cb)
            ;
          } else {
            return cb();
          }
        }
      }),
      err => {
        if (err) {
          if (source instanceof IncomingMessage)
            err.stack += logResInfo(source);
          return reject(err);
        }

        return resolve(query);
      }
    );
  });
}

async function createForm(query) {
  return http.fetch({
      hostname: metadata.hostname,
      path: metadata.formEditPath.concat(query),
    })
      .then(res => 
        new Promise((resolve, reject) => {
          mustStrictEqual(
            res.statusCode,
            200, 
            () => `createForm failed. ${logResInfo(res)}`
          );
          const filepath = join(dumpPath,"./form-backup.html");

          pipeline(
            res,
            createWriteStream(filepath),
            err => err ? reject(err) : resolve(filepath)
          );
        })
      )
  ;
}

async function sendData () {
  return http.fetch(
    {
      method: "post",
      hostname: metadata.hostname,
      path: metadata.postFormPath,
      body: stringify(metadata.secrets.JSONForm),
      headers: {
        "Content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01"
      }
    }
  ).then(res => {
    mustStrictEqual(
      res.statusCode,
      200,
      () => `sendData failed. ${logResInfo(res)}`
    )

    return new Promise((resolve, reject) => {
      pipeline(
        res,
        getJSONParser(),
        new Writable({
          objectMode: true,
          write(result, _, cb) {
            if (!result.isSuccess)
              return cb(new Error(result.msg));
            return cb();
          }
        }),
        err => {
          if (err) {
            err.stack += logResInfo(res);
            return reject(err);
          }
  
          return resolve("done.");
        }
      );
    });
  })
}


async function followRedirect(res) {
  if (![301, 302].includes(res.statusCode))
    return res;

  if (!res.headers.location)
    throw new Error(logResInfo(res));

  let fetchPromise;

  if (/https?:/.test(res.headers.location)) {
    fetchPromise = http.fetch(res.headers.location);
  } else {
    fetchPromise = http.fetch({
      hostname: metadata.hostname,
      path: res.headers.location
    });
  }

  return fetchPromise.then(res => followRedirect(res));
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
    throw emitCallback(err);
  }
}