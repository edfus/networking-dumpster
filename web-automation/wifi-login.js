import { Writable, pipeline } from "stream";
import { existsSync, mkdirSync } from "fs";
import { basename, extname, join } from "path";
import metadata from "./.secrets/wifi-metadata.js";
import { stringify } from "querystring";

import { HTTP, __dirname, helper, JSONP_Parser } from "./helpers.js";
import { inspect } from "util";
import osName from "os-name";
import { platform, release } from "os";

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
  getIP,
  getChallenge,
  ({ ip, challenge }) => computeCredentials({
    challenge: challenge,
    ip
  }),
  login,
  console.info,
  err => {
    if (err)
      throw err;
    process.exitCode = 0;
  }
);

async function getIP() {
  const callbackStr = "callback".concat(Math.random());
  return http.fetch({
    hostname: metadata.hostname,
    protocol: metadata.protocal,
    path: metadata.getIPPath.concat(
      `?${stringify({
        _: Date.now(),
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
      () => new Error(`getIP failed. ${helper.logResInfo(res)}`)
    );

    let user_ip;
    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONP_Parser(callbackStr),
        new Writable({
          objectMode: true,
          write(result, enc, cb) {
            /**
             * domain:
             *  - mac-auth
             *  - after-auth
             */
            switch (result.error) {
              case "not_online_error":
                user_ip = result.client_ip || result.online_ip;
                break;

              case "ok":
                throw "You are already logged in  ".concat(inspect(result)); // string, not an Error instance
              default:
                throw "Unknown error ".concat(inspect(result));
            }

            return cb();
          }
        }),
        err => err ? reject(err) : resolve(user_ip)
      );
    });
  });
}

async function getChallenge(user_ip) {
  const callbackStr = "callback".concat(Math.random());
  return http.fetch({
    hostname: metadata.hostname,
    protocol: metadata.protocal,
    path: metadata.getChallengePath.concat(
      `?${stringify({
        _: Date.now(),
        callback: callbackStr,
        ip: user_ip,
        username: metadata.secrets.username
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
      () => new Error(`getChallenge failed. ${helper.logResInfo(res)}`)
    );

    let challenge;
    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONP_Parser(callbackStr),
        new Writable({
          objectMode: true,
          write(result, enc, cb) {
            switch (result.error) {
              case "ok":
                challenge = result.challenge;
                break;
              default:
                throw "Unknown error ".concat(inspect(result));
            }

            return cb();
          }
        }),
        err => err ? reject(err) : resolve({ challenge, ip: user_ip })
      );
    });
  });
}

async function computeCredentials({ challenge, ip }) {
  const n = 200, type = 1;

  const token = challenge;
  const infoObj = {
    username: metadata.secrets.username,
    password: metadata.secrets.password,
    ip: ip,
    acid: metadata.acid,
    enc_ver: metadata.encoding
  };

  const info = "{SRBX1}".concat(
    xEncode(JSON.stringify(infoObj), token)
  );

  // https://github.com/blueimp/JavaScript-MD5/blob/master/js/md5.js
  const md5passwd = helper.hmac_md5(metadata.secrets.password, token);

  let chkstr = token + metadata.secrets.username;
  chkstr += token + md5passwd;
  chkstr += token + metadata.acid;
  chkstr += token + ip;
  chkstr += token + n;    // 200
  chkstr += token + type; // 1
  chkstr += token + info;

  const os = osName(platform(), release());
  const name = os.split(" ")[0];

  return {
    ip,
    info,
    chksum: helper.sha1string(chkstr),
    password: "{MD5}".concat(md5passwd),
    ac_id: metadata.acid,
    n: n,
    type: type,
    double_stack: 0,
    os,
    name
  };
}

async function login(credentials) {
  const callbackStr = "callback".concat(Math.random());

  return http.fetch({
    hostname: metadata.hostname,
    protocol: metadata.protocal,
    path: metadata.loginPath.concat(
      `?${stringify({
        _: Date.now(),
        action: "login",
        callback: callbackStr,
        username: metadata.secrets.username,
        ...credentials
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
      () => new Error(`login failed. ${helper.logResInfo(res)}`)
    );

    let message;
    return new Promise((resolve, reject) => {
      pipeline(
        res,
        new JSONP_Parser(callbackStr),
        new Writable({
          objectMode: true,
          write(result, enc, cb) {
            helper.mustStrictEqual(
              result.error, "ok",
              () => new Error(`login failed. ${inspect(result)} \n ${helper.logResInfo(res)}`)
            );

            message = result.ploy_msg;

            return cb();
          }
        }),
        err => err ? reject(err) : resolve(message)
      );
    });
  });
}

function xEncode(str, key) {
  if (str == "") {
    return "";
  }
  var v = s(str, true),
    k = s(key, false);
  if (k.length < 4) {
    k.length = 4;
  }
  var n = v.length - 1,
    z = v[n],
    y = v[0],
    c = 0x86014019 | 0x183639A0,
    m,
    e,
    p,
    q = Math.floor(6 + 52 / (n + 1)),
    d = 0;
  while (0 < q--) {
    d = d + c & (0x8CE0D9BF | 0x731F2640);
    e = d >>> 2 & 3;
    for (p = 0; p < n; p++) {
      y = v[p + 1];
      m = z >>> 5 ^ y << 2;
      m += (y >>> 3 ^ z << 4) ^ (d ^ y);
      m += k[(p & 3) ^ e] ^ z;
      z = v[p] = v[p] + m & (0xEFB8D130 | 0x10472ECF);
    }
    y = v[0];
    m = z >>> 5 ^ y << 2;
    m += (y >>> 3 ^ z << 4) ^ (d ^ y);
    m += k[(p & 3) ^ e] ^ z;
    z = v[n] = v[n] + m & (0xBB390742 | 0x44C6F8BD);
  }

  var _PADCHAR = "="
    , _ALPHA = "LVoJPiCN2R8G90yg+hmFHuacZ1OWMnrsSTXkYpUq/3dlbfKwv6xztjI7DeBE45QA";

  return l(v, false);

  function s(a, b) {
    var c = a.length, v = [];
    for (var i = 0; i < c; i += 4) {
      v[i >> 2] = a.charCodeAt(i) | a.charCodeAt(i + 1) << 8 | a.charCodeAt(i + 2) << 16 | a.charCodeAt(i + 3) << 24;
    }
    if (b) {
      v[v.length] = c;
    }
    return v;
  }

  function _getbyte(s, i) {
    var x = s.charCodeAt(i);
    if (x > 255) {
      throw "INVALID_CHARACTER_ERR: DOM Exception 5";
    }
    return x;
  }

  function _encode(s) {
    if (arguments.length !== 1) {
      throw "SyntaxError: exactly one argument required";
    }
    s = String(s);
    var i, b10, x = [], imax = s.length - s.length % 3;
    if (s.length === 0) {
      return s;
    }
    for (i = 0; i < imax; i += 3) {
      b10 = (_getbyte(s, i) << 16) | (_getbyte(s, i + 1) << 8) | _getbyte(s, i + 2);
      x.push(_ALPHA.charAt(b10 >> 18));
      x.push(_ALPHA.charAt((b10 >> 12) & 63));
      x.push(_ALPHA.charAt((b10 >> 6) & 63));
      x.push(_ALPHA.charAt(b10 & 63));
    }
    switch (s.length - imax) {
      case 1:
        b10 = _getbyte(s, i) << 16;
        x.push(_ALPHA.charAt(b10 >> 18) + _ALPHA.charAt((b10 >> 12) & 63) + _PADCHAR + _PADCHAR);
        break;
      case 2:
        b10 = (_getbyte(s, i) << 16) | (_getbyte(s, i + 1) << 8);
        x.push(_ALPHA.charAt(b10 >> 18) + _ALPHA.charAt((b10 >> 12) & 63) + _ALPHA.charAt((b10 >> 6) & 63) + _PADCHAR);
        break;
    }
    return x.join("");
  }

  function l(a, b) {
    // const buffer = new Buffer.alloc(a.length * 8);
    for (let i = 0; i < a.length; i++) {
      // let j = i * 8;
      // buffer.writeUInt16BE(a[i] & 0xff, j);
      // buffer.writeUInt16BE(a[i] >>> 8 & 0xff, j + 2);
      // buffer.writeUInt16BE(a[i] >>> 16 & 0xff, j + 4);
      // buffer.writeUInt16BE(a[i] >>> 24 & 0xff, j + 6);
      a[i] = String.fromCharCode(a[i] & 0xff, a[i] >>> 8 & 0xff, a[i] >>> 16 & 0xff, a[i] >>> 24 & 0xff);
    }
    return _encode(a.join(""));
  }
}