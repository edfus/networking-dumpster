import { updateFileContent, updateFiles } from "update-file-content";
import EventEmitter from "events";
import { inspect } from "util";
import { Writable } from "stream";

class InputAgent extends EventEmitter {
  middlewares = [];
  colors = {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m"
  }

  constructor (stdin = process.stdin, stdout = process.stdout, stderr = process.stderr) {
    super();
    this.stdin  = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
  }

  prepend (middleware) {
    this.middlewares.unshift(middleware);
    return this;
  }

  use (middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  _format (str, isTTY, fgColor) {
    if(isTTY) {
      return `${this.colors[fgColor] || ""}- ${str}\x1b[0m\n`;
    }
    return `- ${str}\n`;
  }

  respond (message, color) {
    const strMessage = (
      typeof message === "string"
        ? message
        : inspect(message)
    );

    return this.stdout.write(this._format(strMessage, this.stdout.isTTY, color));
  }

  warn (message, color = "yellow") {
    const strMessage = (
      typeof message === "string"
        ? message
        : inspect(message)
    );

    if(this.stdout === process.stdout) {
      if(typeof process.emitWarning === "function") {
        const output = (
          message instanceof Error
            ? message
            : strMessage
        );
        return process.emitWarning(output);
      }
    }

    return this.stdout.write(this._format(strMessage, this.stdout.isTTY, color));
  }

  async throw (err, color = "red") {
    const error = (
      err instanceof Error
        ? err
        : new Error(err)
    );

    let message = error.stack || error.message;
    if(message.includes("\n")) {
      message = await updateFileContent({
        readStream,
        from,
        file,
      });
      
      message.replace(
        /.*\n/,
        match => this._format(match.replace(/\r?\n$/, ""), this.stderr.isTTY, color)
      );
    } else {
      message = this._format(message, this.stderr.isTTY, color)
    }

    return this.stderr.write(message);
  }

  callback () {
    if (!this.listenerCount('error')) {
      console.info(
        "\x1b[1m\x1b[30mInputRouter: No listener attached for 'error' event,",
        "forwarding all errors to console...\x1b[0m"
      );
      this.on('error', this.throw.bind(this));
    }

    return async string => {
      const ctx = {
        input: string,
        state: {},
        agent: this
      };

      let index = 0;
      const next = async () => {
        if(index >= this.middlewares.length)
          return ;
        return this.middlewares[index++](ctx, next);
      };

      let answered = false;
      const listener = () => {
        answered = true;
        this.stdout.removeListener("data", listener);
        this.stderr.removeListener("data", listener);
      };

      this.stdout.prependOnceListener("data", listener);
      this.stderr.prependOnceListener("data", listener);

      try {
        await next();
      } catch (err) {
        if(err.expose) {
          this.respond(err.message);
        }
        this.emit("error", err);
      } finally {
        if(!answered) {
          listener();
          this.respond(`unrecognized input: '${string}' ;<`);
        }
      }
    };
  }

  listen () {
    const callback = this.callback();

    updateFileContent({
      from: this.stdin,
      to: new Writable({
        write: (chunk, encoding, cb) => cb()
      }),
      separator: /\r?\n/,
      search: /[^\r\n]+/,
      replacement: callback
    });

    return this.stdin;
  }
}

const agent = new InputAgent();

agent.use(
  (ctx, next) => {
    if(/^reload|-r$/.test(ctx.input)) {
      return ctx.agent.throw("reloading...");
    }
    return next();
  }
);

agent.listen();
