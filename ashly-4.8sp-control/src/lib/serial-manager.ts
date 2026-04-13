/**
 * Serial connection manager for the Ashly Protea 4.8SP.
 * Handles port detection, buffering, echo confirmation, and meter polling.
 */

import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import {
  parseBuffer,
  meterRequest, dataRequest,
  parseMeterResponse, parseGainMessage, parseEQMessage,
  parseDelayMessage, parseCrossoverMessage, parseLimiterMessage,
  parseStatusMessage, parsePresetNamesResponse, parseDeviceNameResponse,
  type ParsedMessage, type DeviceState,
} from './ashly-protocol.js';
import {
  MSG, ECHOED_TYPES, SERIAL_BAUD_RATE, METER_POLL_INTERVAL_MS,
} from './constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SerialManagerEvents {
  connected:    [port: string];
  disconnected: [reason: string];
  meterUpdate:  [data: ReturnType<typeof parseMeterResponse>];
  stateUpdate:  [state: Partial<DeviceState>];
  localChange:  [message: ParsedMessage];
  error:        [err: Error];
  portList:     [ports: PortInfo[]];
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

// ─── Queue entry ─────────────────────────────────────────────────────────────

interface QueueEntry {
  data: Buffer;
  resolve: () => void;
  reject: (err: Error) => void;
  expectEcho: boolean;
  timeout: NodeJS.Timeout | null;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class SerialManager extends EventEmitter {
  private port: SerialPort | null = null;
  private rxBuffer = Buffer.alloc(0);
  private txQueue: QueueEntry[] = [];
  private processing = false;
  private meterTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private currentPort = '';
  private meterIntervalMs: number;

  constructor(meterIntervalMs = METER_POLL_INTERVAL_MS) {
    super();
    this.meterIntervalMs = meterIntervalMs;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async listPorts(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      vendorId: p.vendorId,
      productId: p.productId,
    }));
  }

  async connect(portPath: string): Promise<void> {
    if (this.connected) await this.disconnect();

    return new Promise((resolve, reject) => {
      const sp = new SerialPort({
        path: portPath,
        baudRate: SERIAL_BAUD_RATE,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        autoOpen: false,
      });

      sp.open((err) => {
        if (err) { reject(err); return; }

        this.port = sp;
        this.connected = true;
        this.currentPort = portPath;
        this.rxBuffer = Buffer.alloc(0);

        sp.on('data', (chunk: Buffer) => this.onData(chunk));
        sp.on('close', () => this.onClose());
        sp.on('error', (e: Error) => this.emit('error', e));

        this.emit('connected', portPath);

        // Send initial data request so local change updates are enabled
        this.sendRaw(dataRequest(), true).then(() => {
          this.startMeterPolling();
          resolve();
        }).catch(reject);
      });
    });
  }

  async disconnect(): Promise<void> {
    this.stopMeterPolling();
    if (this.port?.isOpen) {
      await new Promise<void>((res) => this.port!.close(() => res()));
    }
    this.port = null;
    this.connected = false;
    this.currentPort = '';
    this.txQueue = [];
    this.processing = false;
  }

  isConnected(): boolean { return this.connected; }
  getPort(): string { return this.currentPort; }

  send(data: Buffer, expectEcho = false): Promise<void> {
    return this.sendRaw(data, expectEcho);
  }

  setMeterInterval(ms: number): void {
    this.meterIntervalMs = ms;
    if (this.connected) {
      this.stopMeterPolling();
      this.startMeterPolling();
    }
  }

  // ─── Meter polling ─────────────────────────────────────────────────────────

  private startMeterPolling(): void {
    this.meterTimer = setInterval(() => {
      if (this.connected && this.port?.isOpen) {
        this.port.write(meterRequest());
      }
    }, this.meterIntervalMs);
  }

  private stopMeterPolling(): void {
    if (this.meterTimer) { clearInterval(this.meterTimer); this.meterTimer = null; }
  }

  // ─── RX handling ───────────────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);

    // Trim leading bytes that aren't part of a valid frame or meter response
    this.rxBuffer = this.pruneBuffer(this.rxBuffer);

    const { messages, consumed } = parseBuffer(new Uint8Array(this.rxBuffer));
    if (consumed > 0) {
      this.rxBuffer = this.rxBuffer.slice(consumed);
    }

    for (const msg of messages) {
      this.dispatch(msg);
    }
  }

  private pruneBuffer(buf: Buffer): Buffer {
    // Remove any leading bytes that are not 0xF0 (start of frame)
    let i = 0;
    while (i < buf.length && buf[i] !== 0xf0) i++;
    return i > 0 ? buf.slice(i) : buf;
  }

  private dispatch(msg: ParsedMessage): void {
    switch (msg.type) {
      case MSG.METER_RESPONSE: {
        const data = parseMeterResponse(msg.payload);
        this.emit('meterUpdate', data);
        break;
      }

      case MSG.DATA_RESPONSE: {
        // Full state dump — import lazily to avoid circular issues
        import('./ashly-protocol.js').then(({ parseDataResponse }) => {
          const state = parseDataResponse(msg.payload);
          this.emit('stateUpdate', state);
        });
        break;
      }

      case MSG.PRESET_NAMES_RESPONSE: {
        const names = parsePresetNamesResponse(msg.payload);
        this.emit('stateUpdate', { presetNames: names } as any);
        break;
      }

      case MSG.DEVICE_NAME_RESPONSE: {
        const name = parseDeviceNameResponse(msg.payload);
        this.emit('stateUpdate', { deviceName: name } as any);
        break;
      }

      // Local change updates (front-panel edits on the unit)
      case MSG.LOCAL_GAIN:
      case MSG.LOCAL_EQ:
      case MSG.LOCAL_DELAY:
      case MSG.LOCAL_CROSSOVER:
      case MSG.LOCAL_LIMITER:
      case MSG.LOCAL_STATUS:
        this.emit('localChange', msg);
        break;

      // Echo confirmations — unblock TX queue
      default:
        if (ECHOED_TYPES.has(msg.type as any)) {
          this.resolveCurrentQueueItem();
        }
    }
  }

  // ─── TX queue ──────────────────────────────────────────────────────────────

  private sendRaw(data: Buffer, expectEcho: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry: QueueEntry = { data, resolve, reject, expectEcho, timeout: null };
      this.txQueue.push(entry);
      if (!this.processing) this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.txQueue.length === 0) { this.processing = false; return; }
    this.processing = true;
    const entry = this.txQueue[0];

    if (!this.port?.isOpen) {
      this.txQueue.shift();
      entry.reject(new Error('Port not open'));
      this.processQueue();
      return;
    }

    this.port.write(entry.data, (err) => {
      if (err) {
        this.txQueue.shift();
        entry.reject(err);
        this.processQueue();
        return;
      }

      if (!entry.expectEcho) {
        this.txQueue.shift();
        entry.resolve();
        this.processQueue();
      } else {
        // Wait for echo confirmation (or timeout after 500ms)
        entry.timeout = setTimeout(() => {
          this.txQueue.shift();
          entry.reject(new Error('Echo timeout'));
          this.processQueue();
        }, 500);
      }
    });
  }

  private resolveCurrentQueueItem(): void {
    const entry = this.txQueue[0];
    if (!entry?.expectEcho) return;
    if (entry.timeout) clearTimeout(entry.timeout);
    this.txQueue.shift();
    entry.resolve();
    this.processQueue();
  }

  // ─── Port close ────────────────────────────────────────────────────────────

  private onClose(): void {
    this.stopMeterPolling();
    this.connected = false;
    const port = this.currentPort;
    this.currentPort = '';
    this.txQueue.forEach(e => { if (e.timeout) clearTimeout(e.timeout); e.reject(new Error('Port closed')); });
    this.txQueue = [];
    this.processing = false;
    this.emit('disconnected', port);
  }
}
