import { stat, createWriteStream, createReadStream } from "fs";
import { createServer } from "http";
import { extname, basename, join, normalize } from "path";
import { inspect } from "util";
import { pipeline } from "stream";
import mime from "./mime.js";
import pathMap from "./path-map.db.js"

function toLocalPath(path) {
  return join("./files.hidden", normalize(path));
}

const map = pathMap;

const log = {
  error: createWriteStream("./error.log.txt", { flags: "a" }),
  info: createWriteStream("./info.log.txt", { flags: "a" }),
  critical: createWriteStream("./critical.log.txt", { flags: "a" }),
}

const fileServer = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "[::]"}`);

  let filepath = toLocalPath(
    map.has(url.pathname)
                  ? map.get(url.pathname)
                  : url.pathname
  ).replace(/\+/g, " ");

  if(filepath.endsWith("/"))
    filepath = filepath.concat("index.html");

  stat(filepath, (err, stats) => {
    if (err) {
      logError(err, req);
      switch (err.code) {
        case "ENAMETOOLONG":
        case "ENOENT":
        case "ENOTDIR":
          return res.writeHead(404).end("Not Found");
        default:
          return res.writeHead(500).end();
      }
    }

    if (!stats.isFile()) {
      return res.writeHead(404).end("Not Found");
    }

    const filename = basename(filepath);
    const fileExtname = extname(filename);

    if(filename.startsWith("."))
      return res.writeHead(404).end("Not Found");

    const type = mime[fileExtname] || "text/plain";
    const charset = "utf8";

    if(type === "text/plain")
      logCritical(`!mime[${fileExtname}] for ${filename}`);

    const lastModified = stats.mtime.toUTCString();
    const eTag = etag(stats);

    // conditional request
    if(
      (
        req.headers["if-none-match"] &&
        req.headers["if-none-match"] !== eTag
      )
        ||
      (
        req.headers["last-modified"] &&
        req.headers["last-modified"] < lastModified
      )
    ) {
      return res.writeHead(304).end("Not Modified");
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"` //NOTE
    );

    const header = {
      "Content-Type": `${type}${charset ? "; charset=".concat(charset) : ""}`,
      "Last-Modified": lastModified,
      "ETag": eTag,
      "Cache-Control": "private, max-age=864000" // 10 days
    };

    if(stats.size > 27799262)
      header["Transfer-Encoding"] = "chunked";
    // else 
      header["Content-Length"] = stats.size;

    res.writeHead(200, header);

    if (stats.size === 0 || req.method === "HEAD") {
      return res.end();
    }

    //TODO https://stackoverflow.com/a/52105944/13910382

    pipeline(
      createReadStream(filepath),
      res,
      error => error
                ? logError(error, req)
                : logInfo(`Serving file ${filename} to ${req.socket.remoteAddress}:${req.socket.remotePort} succeeded`)
    );
  });
})
  .listen(
    12345,
    () => {
      const address = fileServer.address();
      console.info(
        `File server is running at ${address.family} ${address.address}:${address.port}`
      );
    }
  )
  .on("error", logError)

function logCritical(entry) {
  log.critical.write(
    entry.concat("\n")
  );
}

function logInfo(info) {
  console.info(info);
  log.info.write(
    info.concat("\n")
  );
}

function logError(err, req) {
  log.error.write(
    [
      req && req.url,
      req && inspect(req.headers),
      inspect(err)
    ].join("\n").concat("\n\n")
  );
}

function etag(stats) {
  return `"${stats.mtime.getTime().toString(16)}-${stats.size.toString(16)}"`;
}