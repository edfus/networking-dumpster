import { Writable, pipeline } from "stream";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { HTTP, __dirname, helper, JSONParser } from "./helpers.js";
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

const argvs = process.argv.slice(2);

const httpProxy = extractArg(/^--proxy$/, 1);
const socksProxy = extractArg(/^--socks(5|5h|4a)$/, 1);
const sanitize = extractArg(/^--sanitize$/, 0) !== false;

let proxy;
if(httpProxy) {
  proxy = /^https?:\/\//.test(httpProxy) ? httpProxy : "http://".concat(httpProxy);
} else {
  proxy = socksProxy && socksProxy.replace(/^(?<!socks(5|5h|4a):\/\/)(.)/, "socks5://$2");
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
      http.followRedirect(res, metadata.hostname)
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
  }).then(dom => {
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
      return http.followRedirect(res, metadata.hostname);
    }).then(res => void res.resume());
  });
}

async function getFormModuleId() {
  let id; //
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

    helper.mustStrictEqual(
      source.statusCode,
      200, 
      () => new Error(`getFormModuleId failed. ${helper.logResInfo(source)}`)
    );
  }

  return new Promise((resolve, reject) => {
    pipeline(
      source,
      new JSONParser(),
      new Writable({
        objectMode: true,
        write(result, _, cb) {
          if (!result.isSuccess)
            return cb(new Error(sanitize ? "getFormModuleId received falsy isSuccess" : result.msg));

          id = result.module; //

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
            err.stack += helper.logResInfo(source);
          return reject(err);
        }

        return resolve(id);
      }
    );
  });
}

async function createForm(id) {
  if(!id)
    throw new Error(`createForm received falsy id ${id}`);

  const query = `?zt=00&id=${id}`;

  return http.fetch({
      hostname: metadata.hostname,
      path: metadata.formEditPath.concat(query),
    })
      .then(res => 
        new Promise((resolve, reject) => {
          helper.mustStrictEqual(
            res.statusCode,
            200, 
            () => new Error(`createForm failed. ${helper.logResInfo(res)}`)
          );
          const filepath = join(dumpPath,"./form-backup.html");
          
          pipeline(
            res,
            createWriteStream(filepath),
            err => err ? reject(err) : resolve(id)
          );
        })
      )
  ;
}

async function sendData (id) {
  const JSONForm = {
    info: JSON.stringify({
      model: {
        ...metadata.secrets.JSONForm.info.model,
        id: id
      }
    })
  };

  return http.fetch(
    {
      method: "post",
      hostname: metadata.hostname,
      path: metadata.postFormPath,
      body: stringify(JSONForm),
      headers: {
        "Content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01"
      }
    }
  ).then(res => {
    helper.mustStrictEqual(
      res.statusCode,
      200,
      () => new Error(`sendData failed. ${helper.logResInfo(res)}`)
    )

    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONParser(),
        new Writable({
          objectMode: true,
          write(result, _, cb) {
            if (!result.isSuccess)
              return cb(new Error(sanitize ? "sendData received falsy isSuccess" : result.msg));
            return cb();
          }
        }),
        err => {
          if (err) {
            err.stack += helper.logResInfo(res);
            return reject(err);
          }
  
          return resolve("done.");
        }
      );
    });
  });
}

async function resendUnchecked() {
  return http.fetch(
    {
      method: "post",
      hostname: metadata.hostname,
      path: metadata.getSubmittedFormsPath,
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01"
      }
    }
  ).then(res => {
    helper.mustStrictEqual(
      res.statusCode,
      200,
      () => new Error(`getSubmittedForms failed. ${helper.logResInfo(res)}`)
    );

    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONParser(),
        new Writable({
          objectMode: true,
          write(result, _, cb) {
            if (!result.isSuccess)
              return cb(new Error(sanitize ? "getSubmittedForms received falsy isSuccess" : result.msg));
            const list = result.module.data;

            Promise.all(
              list.map(
                async formDetails => {
                  if(formDetails.zt !== "01") {
                    return sendData(formDetails.id)
                  }
                }
              )
            ).then(() => cb(), cb);
          }
        }),
        err => {
          if (err) {
            err.stack += helper.logResInfo(res);
            return reject(err);
          }
  
          return resolve("resendUnchecked done.");
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