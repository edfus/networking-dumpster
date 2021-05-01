/// <reference types="node" />

import {
  RequestListener,
  Server,
  IncomingMessage,
  ServerResponse
} from "http";
import { EventEmitter } from "events";
import { ListenOptions, Socket } from "net";

/**
 * the prototype from which ctx is created.
 * You may add additional properties to ctx by editing app.context
 */
interface BasicContext {
  app: App;
  /* parameter `properties` not supported */
  throw(status?: number, message?: string): void;
  /* parameter `properties` not supported */
  assert(shouldBeTruthy: any, status?: number, message?: string): void;
}

interface Context extends BasicContext {
  req: IncomingMessage;
  res?: ServerResponse;
  socket: Socket;
  state: {
    head?: Buffer;
    event: "request" | "connect";
  };
  url: string;
  ip: string;
}

type Next = () => Promise<void>;
type Middleware = ((ctx: Context, next: Next) => Promise<void>);

export declare class App extends EventEmitter {
  constructor();
  middlewares: Array<Middleware>;
  context: BasicContext;

  /* NOT in koa! */
  prepend(middleware: Middleware): this;

  use(middleware: Middleware): this;

  callback(): RequestListener;

  /**
   * a copypasta from net.d.ts
   */
  listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void): Server;
  listen(port?: number, hostname?: string, listeningListener?: () => void): Server;
  listen(port?: number, backlog?: number, listeningListener?: () => void): Server;
  listen(port?: number, listeningListener?: () => void): Server;
  listen(path: string, backlog?: number, listeningListener?: () => void): Server;
  listen(path: string, listeningListener?: () => void): Server;
  listen(options: ListenOptions, listeningListener?: () => void): Server;
  listen(handle: any, backlog?: number, listeningListener?: () => void): Server;
  listen(handle: any, listeningListener?: () => void): Server;
}

export declare class ProxyServer {
  constructor(
    downstreamProxyURL: string | URL,
    downstreamProxyOptions: {
      proxyHeaders?: Headers;
      defaultHeaders?: Headers;
      agentOptions: AgentOptions;
    }
  );

  [Symbol.iterator](): IterableIterator<Middleware>;

  requestListener(ctx: Context, next: Next): Promise<void>;
  connectListener(ctx: Context, next: Next): Promise<void>;
}