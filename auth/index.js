import { scrypt } from "crypto";
import { App, Serve } from "@edfus/file-server";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const local = path => join(__dirname, path);

const app = new App();

app.use(
  async (ctx, next) => {
    await next();
    console.info(new Date().toLocaleString(), ctx.ip, ctx.req.method, ctx.url, ctx.res.statusCode)
  }
);

app.use(new Serve().mount(local("./lib")).serveFile).listen(
  8080, "localhost", function () {
    console.info(`Server is running at http://localhost:${this.address().port}`);
  }
);