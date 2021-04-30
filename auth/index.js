import { pbkdf2 } from "crypto";
import { App, Serve } from "@edfus/file-server";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer } from "https";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const local = path => join(__dirname, path);

const app = new App();

app.use(
  async (ctx, next) => {
    await next();
    console.info(new Date().toLocaleString(), ctx.ip, ctx.req.method, ctx.url, ctx.res.statusCode)
  }
);

app.use(new Serve().mount(local("./lib")).serveFile);

createServer(
  {
    key: readFileSync(local("./secrets/server.key")),
    cert: readFileSync(local("./secrets/server.crt"))
  },
  app.callback()
)
.listen(
  8080, "localhost", function () {
    console.info(`Server is running at https://localhost:${this.address().port}`);
  }
);