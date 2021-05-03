import { helper, HTTP } from "../helpers.js";
import { createReadStream } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const http = new HTTP();

// streams = files
const { body, headers } = helper.serializeFormData(
  {
    text: "@#$魔梨沙",
    somethingAdorable: createReadStream(join(__dirname, "./package.json")),
    coolStuff: {
      source: Buffer.from("<object></object>"),
      filename: "*coolest",
      contentType: 'image/jpeg',
      contentTransferEncoding: "binary" // deprecated
    },
    nuclearFusion: [
      {
        source: "<svg></svg>",
        filename: "multi-function cooler",
        contentType: 'image/svg',
        contentTransferEncoding: "base64" // deprecated
      },
      createReadStream(join(__dirname, "./go.mod")),
      {
        source: createReadStream(join(__dirname, "./go.mod")),
        filename: "go.mod",
      }
    ]
  },
  "multipart/form-data"
);

createServer((req, res) => {
  res.writeHead(200, "Echo Service here!")
     .write(Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\n"));
  res.write("\r\n\r\n");
  req.pipe(res);
}).listen(8889, "127.0.0.1", function () {
  http.fetch(`http://127.0.0.1:${this.address().port}`, {
    method: "POST",
    body, headers
  }).then(res => res.pipe(process.stdout));
  this.unref();
});

