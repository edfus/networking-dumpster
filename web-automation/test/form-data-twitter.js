import { helper, HTTP, JSONParser } from "../helpers.js";
import { getOauthHeader, getOauthData } from "./utils/oauth.js";
import credentials from "../.secrets/twitter-creds.js";

import { createReadStream } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipeline, Writable } from "stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const utils = join(__dirname, "./utils");
const http = new HTTP("http://127.0.0.1:8888", true);

const { body, headers } = helper.serializeFormData(
  {
    media_category: "tweet_image",
    media: createReadStream(join(utils,  "./mystia.jpg"))
  },
  "multipart/form-data"
);

http.fetch(
  `https://upload.twitter.com/1.1/media/upload.json?media_category=tweet_image`,
  {
    method: "POST",
    body: body,
    headers: {
      ...getOauthHeader(getOauthData(credentials, {
        method: "POST",
        URI: "https://upload.twitter.com/1.1/media/upload.json",
        qs: {
          media_category: "tweet_image"
        }
      })),
      ...headers
    }
  }
).then(
  res => new Promise((resolve, reject) => {
    pipeline(
      res,
      new JSONParser(),
      new Writable({
        objectMode: true,
        write(obj, _, cb) {
          return cb(resolve(obj));
        }
      }),
      err => err && reject(err)
    )
  })
).then(
  console.dir
);