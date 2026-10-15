// -----------------------------------------------------------------------------
// SLIP framing (RFC 1055) of the Big Ass Fans i6 protocol: every protobuf
// message travels between two 0xC0 bytes on the TCP stream, with 0xC0 and
// 0xDB inside escaped as 0xDB 0xDC and 0xDB 0xDD. Same rules as aiobafi6
// (wireutils.py).
// -----------------------------------------------------------------------------

export const END = 0xc0;
const ESC = 0xdb;
const ESC_END = 0xdc;
const ESC_ESC = 0xdd;

// aiobafi6 expects no message above 4 KiB: a buffer far beyond means the
// stream lost its framing.
export const MAX_BUFFER_BYTES = 64 * 1024;

/** Escape a payload (no delimiters). */
export function escape(payload) {
  const out = [];
  for (const byte of payload) {
    if (byte === END) {
      out.push(ESC, ESC_END);
    } else if (byte === ESC) {
      out.push(ESC, ESC_ESC);
    } else {
      out.push(byte);
    }
  }
  return Buffer.from(out);
}

/** Remove the escapes of a payload; throws on a broken escape sequence. */
export function unescape(payload) {
  const out = [];
  let escaped = false;
  for (const byte of payload) {
    if (escaped) {
      if (byte === ESC_END) {
        out.push(END);
      } else if (byte === ESC_ESC) {
        out.push(ESC);
      } else {
        throw new Error('invalid SLIP escape sequence');
      }
      escaped = false;
    } else if (byte === ESC) {
      escaped = true;
    } else {
      out.push(byte);
    }
  }
  if (escaped) {
    throw new Error('truncated SLIP escape sequence');
  }
  return Buffer.from(out);
}

/** One framed message, ready for the socket. */
export function frame(payload) {
  return Buffer.concat([Buffer.from([END]), escape(payload), Buffer.from([END])]);
}

/**
 * Cuts a TCP stream into messages. `push(chunk)` returns the complete
 * payloads (unescaped) the chunk finished; a partial one waits for the next
 * chunk. Bytes outside a frame and empty frames are skipped: the stream
 * resynchronises on the next delimiter.
 */
export class FrameDecoder {
  constructor({ maxBytes = MAX_BUFFER_BYTES } = {}) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
    this.dropped = 0;
  }

  push(chunk) {
    this.buffer =
      this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    const payloads = [];
    for (;;) {
      const start = this.buffer.indexOf(END);
      if (start === -1) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      const end = this.buffer.indexOf(END, start + 1);
      if (end === -1) {
        // Keep from the opening delimiter on.
        this.buffer = this.buffer.subarray(start);
        break;
      }
      if (end === start + 1) {
        // Two delimiters in a row: the second may open the next frame.
        this.buffer = this.buffer.subarray(end);
        continue;
      }
      try {
        payloads.push(unescape(this.buffer.subarray(start + 1, end)));
      } catch {
        // One broken frame: skip it, the next ones are still good.
        this.dropped += 1;
      }
      this.buffer = this.buffer.subarray(end + 1);
    }
    if (this.buffer.length > this.maxBytes) {
      this.buffer = Buffer.alloc(0);
      throw new Error(`SLIP frame larger than ${this.maxBytes} bytes`);
    }
    return payloads;
  }
}
