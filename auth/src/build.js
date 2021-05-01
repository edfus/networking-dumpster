import { streamEdit } from "stream-editor";
import { EventEmitter } from "events";
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

  _checkIsColorEnabled (tty) {
    return (
      "FORCE_COLOR" in process.env
        ? [1, 2, 3, "", true, "1", "2", "3", "true"].includes(process.env.FORCE_COLOR)
        : !(
          "NO_COLOR" in process.env ||
          process.env.NODE_DISABLE_COLORS == 1 // using == by design
        ) && tty.isTTY
    );
  }

  _format (str, tty, color) {
    if(this._checkIsColorEnabled(tty)) {
      return `${
        color && color.startsWith("\x1b")
         ? color
         : this.colors[color] || ""
      }- ${str}\x1b[0m\n`;
    }
    return `- ${str}\n`;
  }

  async respond (message, color) {
    const strMessage = (
      typeof message === "string"
        ? message
        : inspect(message)
    );

    return new Promise((resolve, reject) => {     
      this.stdout.write(
        this._format(strMessage, this.stdout, color),
        err => err ? reject(err) : resolve(
          this.emit("answer", { name: "respond", message: strMessage })
        )
      );
    });
  }

  async warn (message, color = "yellow", emitWarning = false) {
    const strMessage = (
      typeof message === "string"
        ? message
        : inspect(message)
    );

    if(emitWarning && this.stdout === process.stdout) {
      if(typeof process.emitWarning === "function") {
        const output = (
          message instanceof Error
            ? message
            : strMessage
        );
        process.emitWarning(output);
        return this.emit("answer", { name: "warn", message: output })
      }
    }

    return new Promise((resolve, reject) => {     
      this.stdout.write(
        this._format(strMessage, this.stdout, color),
        err => err ? reject(err) : resolve(
          this.emit("answer", { name: "warn", message: strMessage })
        )
      );
    });
  }

  async throw (err, color = "red") {
    const error = (
      err instanceof Error
        ? err
        : new Error(err)
    );

    let message = error.stack || error.message;
    if(message.includes("\n")) {
      message = message.replace(
        /.*\n/,
        match => this._format(match.replace(/\r?\n$/, ""), this.stderr, color)
      );
    } else {
      message = this._format(message, this.stderr, color)
    }

    if(!message.endsWith("\n"))
      message = message.concat("\n");

    return new Promise((resolve, reject) => {     
      this.stderr.write(message, err => err ? reject(err) : resolve(
        this.emit("answer", { name: "throw", message })
      ));
    });
  }

  callback () {
    if (!this.listenerCount('error')) {
      this.respond(
        [
          "InputAgent: No listener attached for 'error' event,",
          "forwarding all errors to console..."
        ].join(" "), 
        "\x1b[1m\x1b[30m" 
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
        this.removeListener("answer", listener);
      };

      this.emit("input", string);
      this.prependOnceListener("answer", listener);

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
          this.respond(`unrecognized input: '${string}' (..)`);
        }
      }
    };
  }

  listen () {
    const callback = this.callback();

    streamEdit({
      from: this.stdin,
      to: new Writable({
        write: (chunk, encoding, cb) => cb()
      }),
      separator: /[\r\n]+/,
      search: /[^\r\n]+/,
      replacement: callback
    });

    if(this.stdin === process.stdin && !process.listenerCount("SIGINT")) {
      this.respond(
        [
          "InputAgent: No listener attached for 'SIGINT' event,",
          "binding default handler..."
        ].join(" "),
        "\x1b[1m\x1b[30m"
      );

      process.on("SIGINT", () => this.stdin.unref());
    }

    return this.stdin;
  }
}

const agent = new InputAgent();

agent.use(
  (ctx, next) => {
    if(/^(throw|-t)$/.test(ctx.input)) {
      return ctx.agent.throw("wowwwo");
    }
    return next();
  }
);

agent.use(
  (ctx, next) => {
    if(/^(warn|-w)$/.test(ctx.input)) {
      return ctx.agent.warn("nraw");
    }
    if(/^warn!!$/.test(ctx.input)) {
      return ctx.agent.warn("ohnnnooo", null, true);
    }
    return next();
  }
);

agent.use(
  (ctx, next) => {
    if(/^(respond|-r)$/.test(ctx.input)) {
      return ctx.agent.respond({ message: "text!"});
    }
    return next();
  }
);

agent.listen();
