import { Writable, pipeline } from "stream";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { HTTP, __dirname, helper, JSONParser, StringReader } from "./helpers.js";
import { basename, extname, join } from "path";
import { JSDOM } from "jsdom";
import { IncomingMessage } from "http";
import metadata from "./.secrets/cc-metadata.js";
import { stringify } from "querystring";
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
  getToken,
  sendData,
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
  return http.fetch({
    protocol: "https:",
    hostname: metadata.hostname,
    path: metadata.loginPath
  })
    .then(res =>
      http.followRedirect(res, metadata.hostname)
        .then(
          async res => {
            helper.mustStrictEqual(
              res.statusCode,
              200, 
              () => new Error(`getLoginHTML failed. ${helper.logResInfo(res)}`)
            );

            // res.resume();

            return res
            // http.followRedirect(
            //   await http.fetch(
            //     metadata.loginRedirectPath
            //     + encodeURIComponent(
            //       http.lastContext.searchParams.get("redirectUrl")
            //     )
            //   )
            // )
          }
        )
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

async function getToken() {
  // const resultStoreFilepath = join(
  //   dumpPath,
  //   `./edit-query-result-${new Date().toLocaleDateString().replace(/\/|\\/g, "-")
  //   }.json`
  // );

  let source;
  // if (existsSync(resultStoreFilepath)) {
  //   source = createReadStream(resultStoreFilepath);
  // } else {
    source = await http.fetch({
      protocol: "https:",
      hostname: metadata.hostname,
      path: metadata.createFormPath,
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01"
      },
      method: "POST"
    });

    helper.mustStrictEqual(
      source.statusCode,
      200, 
      () => new Error(`getToken failed. ${helper.logResInfo(source)}`)
    );
  // }

  let token; //
  return new Promise((resolve, reject) => {
    pipeline(
      source,
      new StringReader(),
      new Writable({
        objectMode: true,
        write(result, _, cb) {
          // if (!result.isSuccess)
          //   return cb(new Error(sanitize ? "getToken received falsy isSuccess" : result.msg));

          token = result; //

          // if (source instanceof IncomingMessage) {
          //   createWriteStream(resultStoreFilepath)
          //     .end(JSON.stringify(result), cb)
          //   ;
          // } else {
            return cb();
          // }
        }
      }),
      err => {
        if (err) {
          if (source instanceof IncomingMessage)
            err.stack += helper.logResInfo(source);
          return reject(err);
        }

        return resolve(token);
      }
    );
  });
}

async function createForm(token) {
  if(!token)
    throw new Error(`createForm received falsy token ${token}`);

  const query = `?zt=00&token=${token}`;

  return http.fetch({
      protocol: "https:",
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

          const filepath = join(dumpPath, "./form-backup.html");
          
          pipeline(
            res,
            createWriteStream(filepath),
            err => err ? reject(err) : resolve(token)
          );
        })
      )
  ;
}

async function sendData (token) {
  const JSONForm = {
    info: JSON.stringify({
      model: {
        ...metadata.secrets.JSONForm.info.model,
      },
      token: token
    })
  };

  return http.fetch(
    {
      protocol: "https:",
      method: "POST",
      hostname: metadata.hostname,
      path: metadata.postFormPath,
      body: stringify(JSONForm), // querystring.stringify
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
      protocol: "https:",
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
                    return sendData(formDetails.token)
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