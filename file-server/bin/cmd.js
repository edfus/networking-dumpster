#!/usr/bin/env node

import FileServer from "../file-server.js";
import { inspect } from "util";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createWriteStream, existsSync, promises as fsp } from "fs";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const local = path => join(__dirname, path);

if(!existsSync(local("../node_modules/prompts/index.js"))) {
  throw new Error(
    [
      `Can't find dependency 'prompts' at ${local("../node_modules/prompts")}`,
      "Try 'npm install prompts'"
    ].join("\n")
  )
}

class JSONCache {
  encryptedIdentifier = Buffer.from("---ENCRYPTED---\n");

  set (cachename, obj) {
    const cache = createWriteStream(local(cachename.concat(".cache")));
  
    if(obj.password) {
      randomBytes(16, (err, iv) => {
        if(err) return console.error(err);
        const key = createHash('sha1').update(obj.password).digest().slice(0, 16);
        const cipher = createCipheriv("aes-128-gcm", key, iv);

        const body = Buffer.concat([
          cipher.update(Buffer.from(JSON.stringify(obj))),
          cipher.final()
        ]);

        cache.end(Buffer.concat([
          this.encryptedIdentifier,
          iv,
          cipher.getAuthTag().slice(0, 16),
          body
        ]));
      });
    } else {
      cache.end(JSON.stringify(obj));
    }
  }

  has (cachename) {
    return existsSync(local(cachename.concat(".cache")));
  }

  async get (cachename, passwordCallback) {
    if(!this.has(cachename))
      return false;

    const rawData = await fsp.readFile(local(cachename.concat(".cache")));
    const mightbeId = rawData.slice(0, this.encryptedIdentifier.length);

    if (Buffer.compare(mightbeId, this.encryptedIdentifier) === 0) {
      let offset = this.encryptedIdentifier.length;

      const iv = rawData.slice(offset, offset += 16);
      const tag = rawData.slice(offset, offset += 16);
      const encrypted = rawData.slice(offset);

      const password = await passwordCallback();
      if(!password.length) 
        return false;

      const key = createHash('sha1').update(password).digest().slice(0, 16);
      const decipher = createDecipheriv("aes-128-gcm", key, iv).setAuthTag(tag);

      const jsonData = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]).toString("utf8");

      return JSON.parse(jsonData);
    } else {
      return JSON.parse(rawData)
    }
  }
}

class Log {
  constructor (outputDir) {
    this.outputDir = outputDir || "./";
  }
  critical(entry) {
    if(!this._critical)
      this._critical = createWriteStream(join(this.outputDir, "./critical.log.txt"), { flags: "a" });
    console.error(entry);
    this._critical.write(
      String(entry).concat("\n")
    );
  }
  
  info(info) {
    if(!this._info)
      this._info = createWriteStream(join(this.outputDir, "./info.log.txt"), { flags: "a" });
    console.info(info);
    this._info.write(
      info.concat("\n")
    );
  }

  error(err, req) {
    if(!this._error)
      this._error = createWriteStream(join(this.outputDir, "./error.log.txt"), { flags: "a" });
    this._error.write(
      [
        req && req.url,
        req && inspect(req.headers),
        inspect(err)
      ].join("\n").concat("\n\n")
    );
    console.error(err);
  }
}

/**
 * 
 * main
 * 
 */

(async () => {
  const cache = new JSONCache();
  const prompt = (await import("../node_modules/prompts/index.js")).default.prompt;

  let passwd_tmp;
  const questions = [
    {
      type: 'text',
      name: 'location',
      initial: "./",
      message: 'Enter the root folder for serving files',
      validate (path) {
        if(existsSync(path)) {
          return true;
        } else {
          return `${path} DO NOT exist`;
        }
      }
    },
    {
      type: 'text',
      name: 'hostname',
      initial: "localhost",
      message: 'Enter the hostname'
    },
    {
      type: 'number',
      name: 'port',
      initial: 12345,
      min: 0,
      max: 65565,
      message: 'Enter the port to be listened'
    },
    {
      type: 'text',
      name: 'logPath',
      initial: "./",
      message: 'Enter the log output directory'
    },
    {
      type: 'toggle',
      name: 'useSelfSignedCert',
      message: 'Use self signed certificate?',
      initial: true,
      active: 'Yes',
      inactive: 'No'
    },
    {
      type: prev => !prev && 'text',
      name: 'cert',
      message: 'Enter the certificate path',
      validate (path) {
        if(existsSync(path)) {
          return true;
        } else {
          return `${path} DO NOT exist`;
        }
      },
      initial: "./server.crt"
    },
    {
      type: prev => !prev && 'text',
      name: 'key',
      message: 'Enter the private key path',
      validate (path) {
        if(existsSync(path)) {
          return true;
        } else {
          return `${path} DO NOT exist`;
        }
      },
      initial: "./server.key"
    },
    {
      type: 'toggle',
      name: 'isAuthEnabled',
      message: 'Enable authorization?',
      initial: true,
      active: 'Yes',
      inactive: 'No'
    },
    {
      type: prev => prev && 'text',
      name: 'username',
      message: 'Username'
    },
    {
      type: prev => prev && 'password',
      name: 'password',
      message: 'Password'
    },
    {
      type: prev => prev && 'password',
      name: '_passwd_confirm',
      validate: value => value === passwd_tmp,
      initial (prev) {
        passwd_tmp = prev;
        return "";
      },
      message: 'Confirm password'
    },
    {
      type: prev => prev && 'multiselect',
      name: 'auth',
      message: 'Restricted realms where login is required',
      hint: true,
      choices: [
        { title: 'Upload files', value: '/upload' },
        { title: 'Browse files in folder', value: '/api' },
        { title: 'All', value: '.*' }
      ]
    }
  ];

  let requirements = await cache.get(
    "requirements",
    () => prompt({
      type: 'password',
      name: 'password',
      message: 'To recall your previous configuration, enter the password'
    }).then(({ password }) => password)
  ).catch(
    err => console.info("Cache file corrupted. ", err)
  );

  let shouldPrompt = true;

  if(requirements) {
    shouldPrompt = !(await prompt({
      type: 'toggle',
      name: 'load',
      message: 'Load previous configuration?',
      initial: true,
      active: 'Yes',
      inactive: 'No'
    })).load;
  }

  if(shouldPrompt) {
    requirements = await prompt(questions);
    if(Object.keys(requirements).length > 5)
      cache.set("requirements", requirements);
  }

  const log = new Log(requirements.logPath || "./");

  if(!requirements.key || !requirements.cert) {
    if(!["localhost", "127.0.0.1"].includes(requirements.hostname)) {
      throw new Error("Self signed certificate is valid only for hostnames ['localhost', '127.0.0.1']");
    }
  }

  const keyPromise = fsp.readFile(requirements.key || local("./dev/server.key"));
  const certPromise = fsp.readFile(requirements.cert || local("./dev/server.crt"));

  const server = new FileServer({
    key: await keyPromise,
    cert: await certPromise,
    logger: log
  });

  server.default(requirements.location || ".");

  if (requirements.auth?.length) {
    requirements.auth = requirements.auth.map(
      ruleStr => new RegExp(ruleStr, "i")
    );

    const basicAuth = Buffer.from(
      `${requirements.username}:${requirements.password}`
    ).toString("base64");

    server.prependListener(
      (url, req, res) => {
        if (requirements.auth.some(rule => rule.test(url.pathname))) {
          const authorization = req.headers["authorization"];

          if (!authorization) {
            res.writeHead(401, {
              "WWW-Authenticate": `Basic realm="restricted"`,
              "Content-Length": 0
            }).end();
            return true;
          }

          if (authorization !== `Basic ${basicAuth}`) {
            res.writeHead(401, {
              "WWW-Authenticate": `Basic realm="restricted"`
            }).end("Wrong username or password");
            return true;
          }
          return false;
        }
      }
    );
  }

  server.listen(
    requirements.port || 0,
    requirements.hostname || "localhost",
    function () {
      console.info(
        `File server is running at https://${getServerAddress(this)}`
      );
    }
  );

  process.on("SIGINT", () => {
    server.http.close();
    server.https.close();
    server.tcp.close();
  });

  process.on('uncaughtExceptionMonitor', err => {
    log.critical("There was an uncaught error\n".concat(err.stack));
  });  
})();

function getServerAddress(server) {
  const address = server.address();
  return (
    address.family === "IPv6"
    ? `[${address.address}]:${address.port}`
    : `${address.address}:${address.port}`
  );
}