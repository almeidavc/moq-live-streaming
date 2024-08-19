import { Frame, FrameInfo, FrameType, RawFrame } from "./types";

type ReceivedObject = {
  payloadSize: number;
  receivedAt: number;
  frameType: FrameType;
};

type RenderedFrame = {
  presentationTime: number;
  frameType: FrameType;
  latencyMs: number;
};

// session begins on play() and ends on pause()
export type SessionLogs = {
  mediaReceived: ReceivedObject[];
  rendered: RenderedFrame[];
  bufferingEvents: {
    type: "bufferingStart" | "bufferingEnd";
    timestamp: number;
  }[];
  framesDropped: { frameType: FrameType; dts: number }[];
  framesExtracted: RawFrame[];
  framesDecoded: RawFrame[];
};

export class Logger {
  #enabled: boolean = false;
  #logs: SessionLogs | undefined;

  startSession() {
    this.#enabled = true;
    this.#logs = {
      rendered: [],
      bufferingEvents: [],
      mediaReceived: [],
      framesDropped: [],
      framesExtracted: [],
      framesDecoded: [],
    };
  }

  endSession() {
    this.#enabled = false;
  }

  getLogs() {
    if (!this.#logs) {
      throw Error("no logs");
    }
    return this.#logs;
  }

  onReceived(received: RawFrame) {
    // console.log("received: ", received);
    if (!this.#enabled) return;
    this.#logs?.mediaReceived.push({
      frameType: received.frameType,
      payloadSize: received.data.byteLength,
      receivedAt: performance.now(),
    });
  }

  onDrop(frame: RawFrame) {
    console.log("dropping late frame: ", frame);
    if (!this.#enabled) return;
    this.#logs?.framesDropped.push({
      frameType: frame.frameType,
      dts: frame.dts,
    });
  }

  onExtract(frame: RawFrame) {
    if (!this.#enabled) return;
    this.#logs?.framesExtracted.push(frame);
  }

  onDecode(frame: RawFrame) {
    if (!this.#enabled) return;
    this.#logs?.framesDecoded.push(frame);
  }

  onRender(frame: Frame, latencyMs: number) {
    // console.log("latency: ", latencyMs);
    if (!this.#enabled) return;
    const presentationTime = frame.videoFrame.timestamp / 1000;
    this.#logs?.rendered.push({
      frameType: frame.frameType,
      presentationTime,
      latencyMs,
    });
  }

  onBufferingStart(timestamp: number) {
    if (!this.#enabled) return;
    this.#logs?.bufferingEvents.push({
      type: "bufferingStart",
      timestamp,
    });
  }

  onBufferingEnd(timestamp: number) {
    if (!this.#enabled) return;
    this.#logs?.bufferingEvents.push({
      type: "bufferingEnd",
      timestamp,
    });
  }
}
