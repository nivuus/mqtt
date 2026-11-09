// src/websocket/__tests__/rawClient.ts
//
// Minimal WebSocket client over a raw TCP socket, so a test controls exactly
// when frames hit the wire: several frames in one write (a burst), or frames
// written after the server has started closing without answering its close.

import { connect, Socket } from 'net';
import { randomBytes } from 'crypto';

/** Encode one masked text frame (client-to-server frames must be masked). */
export function textFrame(payload: object): Buffer {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  if (data.length > 0xffff) throw new Error('frame too large for this helper');
  const header = data.length < 126
    ? Buffer.from([0x81, 0x80 | data.length])
    : Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 0xff]);
  const mask = randomBytes(4);
  const masked = Buffer.from(data.map((byte, i) => byte ^ mask[i % 4]));
  return Buffer.concat([header, mask, masked]);
}

/** Open a TCP connection and complete the WebSocket handshake. */
export function rawConnect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => { /* resets after a server terminate are expected */ });
    socket.once('connect', () => {
      socket.write([
        'GET / HTTP/1.1', `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13', '', '',
      ].join('\r\n'));
    });
    socket.once('data', (chunk) => {
      if (chunk.toString('latin1').startsWith('HTTP/1.1 101')) resolve(socket);
      else reject(new Error(`handshake failed: ${chunk.toString('latin1').split('\r\n')[0]}`));
    });
  });
}

/** Write without failing when the server already reset the connection. */
export function writeQuietly(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) return resolve();
    socket.write(data, () => resolve());
  });
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
