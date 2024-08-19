import { Session } from "@mengelbart/moqjs";
import * as MP4Box from "mp4box";
import { calculateMetrics } from "./Metrics";
import { RawFrame, ParsedFrame, Frame } from "./types";
import { Logger } from "./Logger";
import { Mp4Info, Mp4Parser } from "./Mp4Parser";

export const RENDER_BUFFER_SIZE_MS = 100;

export type StartAt = { mode: "live" } | { mode: "future"; group: number };

type PlayerState = "PAUSED" | "BUFFERING" | "PLAYING";

export type PlayerProps = {
  session: Session;
  renderFrame: (frame: VideoFrame) => void;
  namespace?: string;
  initTrackName?: string;
  videoTrackName?: string;
  bufferSizeMs?: number;
};

export class Player extends EventTarget {
  session: Session;
  namespace: string;
  initTrackName: string;
  videoTrackName: string;
  renderFrame;

  // init segment is the ftyp + moov boxes
  initSegment: Uint8Array;
  initTrack: ReadableStream;
  // TODO: unset this when init track subscription done
  initTrackSubscriptionId: number;
  videoTrack: ReadableStream;
  videoTrackSubscriptionId: number;

  buffer: Frame[] = [];
  bufferSizeMs: number;
  playerState: PlayerState = "PAUSED";
  // time at which first frame was rendered since last pause or buffer event
  resumedPlayingAt:
    | {
        localTime: number;
        mediaTime: number;
      }
    | undefined;

  mp4Info: Mp4Info | undefined;

  // time at which first frame received by the client
  // was available at the server (in ms)
  firstFrameAvailabilityTime;
  firstFrameMediaTime;

  // reorder buffer state
  reorderBuffer: RawFrame[] = [];

  processing: Map<number, RawFrame> = new Map();

  logger: Logger;
  mp4Parser: Mp4Parser;
  isRebuffering: boolean = false;

  lastFrameRendered: Frame | undefined;

  constructor({
    session,
    renderFrame,
    namespace = "livestream",
    initTrackName = "init",
    videoTrackName = "video",
    bufferSizeMs = RENDER_BUFFER_SIZE_MS,
  }: PlayerProps) {
    super();
    this.session = session;
    this.bufferSizeMs = bufferSizeMs;
    this.renderFrame = renderFrame;
    this.namespace = namespace;
    this.initTrackName = initTrackName;
    this.videoTrackName = videoTrackName;
    this.logger = new Logger();
    this.mp4Parser = new Mp4Parser(this.logger);
  }

  async setup() {
    if (!this.initSegment) {
      const initTrackSub = await this.session.subscribe(
        this.namespace,
        this.initTrackName,
        { mode: 1, value: 0 },
        { mode: 1, value: 0 },
        { mode: 1, value: 0 },
        { mode: 1, value: 0 },
      );
      console.log("subscribed to init track");
      if (!initTrackSub) {
        throw Error("Couldn't subscribe to init track");
      }
      this.initTrack = await initTrackSub.readableStream;
      this.initTrackSubscriptionId = initTrackSub.subscribeId;
      const firstChunkReader = this.initTrack.getReader();
      const { value: initObject } = await firstChunkReader.read();
      firstChunkReader.releaseLock();
      this.initSegment = initObject;
    }

    this.mp4Info = await this.mp4Parser.configure(this.initSegment);
  }

  async pause() {
    this.logger.endSession();
    this.playerState = "PAUSED";
    // TODO: check that unsubscribe was successfull
    if (this.initTrackSubscriptionId) {
      this.session.unsubscribe(this.initTrackSubscriptionId);
    }
    if (this.videoTrackSubscriptionId) {
      this.session.unsubscribe(this.videoTrackSubscriptionId);
    }
  }

  getSessionMetrics() {
    const logs = this.logger.getLogs();
    console.log(logs);
    return calculateMetrics(logs);
  }

  startLoggerSession() {
    this.logger.startSession();
  }

  parseRawFrames() {
    return new TransformStream<Uint8Array, RawFrame>({
      transform: (object, controller) => {
        const view = new DataView(object.buffer);
        const frameType = ["P", "B", "I"][view.getUint8(0)] as "P" | "B" | "I";
        const availabilityTime = Number(view.getBigUint64(1, false));
        if (!this.firstFrameAvailabilityTime) {
          this.firstFrameAvailabilityTime = availabilityTime / 1_000_000;
        }
        const dts = view.getBigUint64(9, false);
        const pts = view.getBigUint64(17, false);
        const data = object.buffer.slice(25);
        const rawFrame = {
          frameType,
          availabilityTime,
          dts: Number(dts),
          pts: Number(pts),
          data,
        };
        controller.enqueue(rawFrame);
        this.logger.onReceived(rawFrame);
        // this.processing.set(rawFrame.pts, rawFrame);
      },
    });
  }

  decodeFrames() {
    let videoDecoder: VideoDecoder | undefined;
    // maps frames timestamps (presentation time) to the frame's availability time
    return new TransformStream<ParsedFrame, Frame>({
      transform: async (encodedFrame, controller) => {
        if (!videoDecoder) {
          videoDecoder = new VideoDecoder({
            output: (videoFrame: VideoFrame) => {
              const pts = Math.round(
                (videoFrame.timestamp * this.mp4Info!.videoTrack.timescale) /
                  1_000_000,
              );
              const frame = this.processing.get(pts);
              if (!frame) {
                throw Error("frame not in processing map");
              }
              this.processing.delete(pts);
              controller.enqueue({ ...frame, videoFrame });
              this.logger.onDecode(frame);
            },
            error: (err) => {
              throw err;
            },
          });
          // configure video decoder
          const buffer = new MP4Box.DataStream(
            undefined,
            0,
            MP4Box.DataStream.BIG_ENDIAN,
          );
          // https://github.com/kixelated/moq-js/blob/main/lib/playback/worker/video.tsL57
          encodedFrame.description.avcC.write(buffer);
          const description = new Uint8Array(buffer.buffer, 8);
          const config: VideoDecoderConfig = {
            codec: this.mp4Info!.videoTrack.codec,
            codedWidth: this.mp4Info!.videoTrack.width,
            codedHeight: this.mp4Info!.videoTrack.height,
            description: description,
            optimizeForLatency: true,
            // this fixed the occasioanal error: "Uncaught DOMException: Decoding error"
            hardwareAcceleration: "prefer-software",
          };
          const { supported } = await VideoDecoder.isConfigSupported(config);
          if (!supported) {
            console.error("Video codec not supported");
          }
          videoDecoder.configure(config);
        }

        // decode frame
        videoDecoder.decode(
          new EncodedVideoChunk({
            type: encodedFrame.is_sync ? "key" : "delta",
            data: encodedFrame.data,
            timestamp:
              (encodedFrame._pts / encodedFrame!.timescale) * 1_000_000,
            duration:
              (encodedFrame.duration / encodedFrame!.timescale) * 1_000_000,
          }),
        );
      },
    });
  }

  calculateFrameLatency(frame: VideoFrame) {
    const actualMediaTime = Date.now() - this.firstFrameAvailabilityTime;
    const localMediaTime = (frame.timestamp - this.firstFrameMediaTime) / 1000;
    return actualMediaTime - localMediaTime;
  }

  currentBufferSize() {
    if (this.buffer.length === 0) return 0;
    const newestFrame = this.buffer[this.buffer.length - 1]!;
    return (
      (newestFrame.videoFrame.timestamp +
        newestFrame.videoFrame.duration -
        this.buffer[0]!.videoFrame.timestamp) /
      1000
    );
  }

  onPlay() {
    this.buffer = [];
    this.resumedPlayingAt = undefined;
    this.playerState = "BUFFERING";
    this.onBufferingStart();
  }

  onBufferingStart() {
    const timestamp = performance.now();
    this.logger.onBufferingStart(timestamp);
    this.dispatchEvent(
      new CustomEvent("bufferingStart", {
        detail: { timestamp, isRebuffering: this.isRebuffering },
      }),
    );
  }

  onBufferingEnd() {
    const timestamp = performance.now();
    this.logger.onBufferingEnd(timestamp);
    this.dispatchEvent(
      new CustomEvent("bufferingEnd", {
        detail: { timestamp, isRebuffering: this.isRebuffering },
      }),
    );
    this.isRebuffering = true;
  }
}
