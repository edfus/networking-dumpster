import { Writable, pipeline } from "stream";
import { existsSync, mkdirSync } from "fs";
import { basename, extname, join } from "path";
import metadata from "./.secrets/wifi-metadata.js";
import { stringify } from "querystring";

import { HTTP, __dirname, helper, JSONP_Parser } from "./helpers.js";
import { inspect } from "util";

const __filename = basename(import.meta.url);
const dumpPath = join(
  __dirname,
  `./${__filename.substring(0, __filename.length - extname(__filename).length)}.dump`
);

if (!existsSync(dumpPath))
  mkdirSync(dumpPath);

const useProxy = /--proxy/.test(process.argv[2]) || false;
const http = new HTTP("http://localhost:8888", useProxy);

helper.series(
  getUserInfo,
  console.info,
  err => {
    if(err)
      throw err;
    process.exitCode = 0;
  }
);

async function getUserInfo () {
  const callbackStr = "callback".concat(Math.random());
  return http.fetch({
    hostname: metadata.hostname,
    protocol: metadata.protocal,
    path: metadata.getUserInfoPath.concat(
      `?${
        stringify({
          _: metadata.secrets.id,
          callback: callbackStr
        })
      }`
    ),
    headers: {
      "accept": "text/javascript, application/javascript",
      "x-requested-with": "XMLHttpRequest"
    }
  }).then(res => {
    helper.mustStrictEqual(
      res.statusCode, 200,
      () => new Error(`getUserInfo failed. ${helper.logResInfo(res)}`)
    );

    let info;
    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONP_Parser(callbackStr),
        new Writable({
          objectMode: true,
          write (result, enc, cb) {
            /**
             * domain:
             *  - mac-auth
             *  - after-auth
             */
            if(result.error === "ok") {
              throw "You are already logged in  ".concat(inspect(result)); // string, not an Error instance
            }

            debugger;
            info = result;
            return cb();
          }
        }),
        err => err ? reject(err) : resolve(info)
      );
    });
  })
}