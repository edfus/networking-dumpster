import { stat, createWriteStream, createReadStream, readFileSync } from "fs";
import { createServer as https_server } from "https";
import { createServer as http_server } from "http";
import { createServer as net_server } from "net";
import { extname, basename, join, normalize, dirname } from "path";
import { inspect } from "util";
import { pipeline } from "stream";
import mime from "./src/mime.js";
import pathMap from "./path-map.db.js";
import { fileURLToPath } from "url";


const __dirname = dirname(fileURLToPath(import.meta.url));

function toLocalPath(path) {
  return join(__dirname, "./files.hidden", normalize(decodeURIComponent(path)));
}

const map = pathMap;

const log = {
  error: createWriteStream("./error.log.txt", { flags: "a" }),
  info: createWriteStream("./info.log.txt", { flags: "a" }),
  critical: createWriteStream("./critical.log.txt", { flags: "a" }),
};

const servers = {
  https: https_server(
    {
      key: readFileSync("./src/cert.key"),
      cert: readFileSync("./src/cert.pem")
    },
    requestListener
  ).on("error", logCritical),

  http: http_server((req, res) => 
    res.writeHead(301, {
      "Location": `https://${req.headers.host}${req.url}`
    }).end()
  ).on("error", logCritical)
};

const tcpServer =
net_server(socket => {
  socket.once("data", chunk => {
    socket.pause().unshift(chunk);

    servers[chunk[0] === 22 ? "https" : "http"]
      .emit("connection", socket);

    process.nextTick(() => socket.resume());
  });
})
  .listen(
    12345,
    function () {
      const address = this.address();
      console.info(
        `File server is running at ${address.family} ${address.address}:${address.port}`
      );
    }
  )
;

const implementedMethods = ["GET", "PUT", "HEAD"];

function requestListener (req, res) {
  if (!implementedMethods.includes(req.method.toUpperCase()))
    return res.writeHead(501).end();

  const url = new URL(req.url, `http://${req.headers.host || "[::]"}`);

  if (url.pathname.endsWith("/"))
    url.pathname = url.pathname.concat("index.html");

  const filepath = url.pathname === "/index.html"
    ? join(__dirname, "./src/index.html")
    : toLocalPath(
          map.has(url.pathname)
            ? map.get(url.pathname)
            : url.pathname
        ).replace(/\+/g, " ")
  ;

  const isDownload = url.searchParams.get("d") || url.searchParams.get("download");

  stat(filepath, (err, stats) => {
    if (err) {
      logError(err, req);
      switch (err.code) {
        case "ENAMETOOLONG":
        case "ENOENT":
        case "ENOTDIR":
          return res.writeHead(404).end("Not Found");
        default:
          return res.writeHead(500).end(err.message);
      }
    }

    if (!stats.isFile()) {
      return res.writeHead(404).end("Not Found");
    }

    const filename = basename(filepath);
    const fileExtname = extname(filename);

    if (filename.startsWith("."))
      return res.writeHead(404).end("Not Found");

    const type = mime[fileExtname] || "text/plain";
    const charset = "utf8";

    if (type === "text/plain")
      logCritical(`!mime[${fileExtname}] for ${filename}`);

    const lastModified = stats.mtime.toUTCString();
    const eTag = etag(stats);

    // conditional request
    if (
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

    const headers = {
      "Content-Type": `${type}${charset ? "; charset=".concat(charset) : ""}`,
      "Last-Modified": lastModified,
      "ETag": eTag,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=864000" // 10 days
    };

    if (isDownload) {
      headers["Content-Disposition"]
        = `attachment; filename="${encodeURIComponent(filename)}"`
        ;
    }

    if (stats.size === 0)
      return res.writeHead(204, "Empty file", headers).end("Empty file");

    let _start_ = 0, _end_ = stats.size - 1;
    if (req.headers["range"]) {
      const range = req.headers["range"];
      let { 0: start, 1: end } = (
        range.replace(/^bytes=/, "")
          .split("-")
          .map(n => parseInt(n, 10))
      );
      end = isNaN(end) ? stats.size - 1 : end;
      start = isNaN(start) ? stats.size - end - 1 : start;

      if (!isInRange(-1, start, end, stats.size)) {
        headers["Content-Range"] = `bytes */${stats.size}`;
        return res.writeHead(416, headers).end();
      }

      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Length": String(end - start + 1),
      });

      /**
       * Range: bytes=1024-
       * -> Content-Range: bytes 1024-2047/2048
       */

      /**
       * https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
       * An example to read the last 10 bytes of a file which is 100 bytes long:
       * createReadStream('sample.txt', { start: 90, end: 99 });
       */
      _start_ = start;
      _end_ = end;
    } else {
      // if (stats.size > 27799262) // roughly 25 MiB
      //   headers["Transfer-Encoding"] = "chunked";
      headers["Content-Length"] = stats.size;
      res.writeHead(200, headers);
    }

    if (req.method.toUpperCase() === "HEAD") {
      return res.end();
    }

    pipeline(
      // Number.MAX_SAFE_INTEGER is 8192 TiB
      createReadStream(filepath, { start: _start_, end: _end_ }),
      res,
      error => error
        ? logError(error, req)
        : logInfo(`Serving file ${filename} to ${req.socket.remoteAddress}:${req.socket.remotePort} succeeded`)
    );
  });
}

process.on('uncaughtExceptionMonitor', err => {
  logCritical("There was an uncaught error");
  logCritical(err);
});

process.on("SIGINT", () => {
  servers.http.close();
  servers.https.close();
  tcpServer.close();
});

function logCritical(entry) {
  console.error(entry);
  log.critical.write(
    String(entry).concat("\n")
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

function isInRange(...ranges) {
  for (let i = 0; i < ranges.length - 1; i++) {
    if (ranges[i] >= ranges[i + 1]) {
      return false;
    }
  }
  return true;
}