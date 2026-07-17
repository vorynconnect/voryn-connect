import type { Server as SocketIOServer } from 'socket.io';

/**
 * Realtime emitter registry. server.ts registers its Socket.IO instance on
 * boot; domain services emit through the getter. Keeping this out of
 * server.ts means importing a service never starts an HTTP listener
 * (important for tests and future workers).
 */
let ioInstance: SocketIOServer | null = null;

export function registerIo(io: SocketIOServer) {
  ioInstance = io;
}

export function getIo(): SocketIOServer | null {
  return ioInstance;
}
