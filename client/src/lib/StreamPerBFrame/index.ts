import { Frame } from "../types";
import { ReorderBufferBFrames } from "./ReorderBuffer";
import { Player, PlayerProps } from "../Player";

type MODE = "STREAM_PER_GOP" | "STREAM_PER_B_FRAME";
const MODE: MODE = "STREAM_PER_GOP";

const REORDER_BUFFER_SIZE_MS = 200;

type StartAt = { mode: "live" } | { mode: "future"; group: number };

export class StreamPerBFrame extends Player {
  constructor(props: PlayerProps) {
    super(props);
  }

  async play(startAt: StartAt = { mode: "live" }) {
    this.onPlay();
    await this.setup();

    const subscribeLocations =
      startAt.mode === "live"
        ? [
            { mode: 3, value: 0 },
            { mode: 0, value: 0 },
            { mode: 0, value: 0 },
            { mode: 0, value: 0 },
          ]
        : [
            { mode: 1, value: startAt.group },
            { mode: 0, value: 0 },
            { mode: 0, value: 0 },
            { mode: 0, value: 0 },
          ];

    const videoTrackSub = await this.session.subscribe(
      this.namespace,
      this.videoTrackName,
      ...subscribeLocations,
    );
    if (!videoTrackSub) {
      throw Error("Couldn't subscribe to video track");
    }
    console.log("subscribed to video track");
    this.videoTrackSubscriptionId = videoTrackSub.subscribeId;

    const bFramesTrackSub = await this.session.subscribe(
      this.namespace,
      "b-frames",
      ...subscribeLocations,
    );
    if (!bFramesTrackSub) {
      throw Error("Couldn't subscribe to b-frames track");
    }
    console.log("subscribed to b-frames track");

    this.videoTrack = await videoTrackSub.readableStream;
    const bFramesTrack = await bFramesTrackSub.readableStream;

    const parseRawFrames = this.parseRawFrames();
    const reorderBuffer = new TransformStream(
      new ReorderBufferBFrames(
        this.reorderBuffer,
        (REORDER_BUFFER_SIZE_MS / 1000) * this.mp4Info!.videoTrack.timescale,
        this.logger,
      ),
    );
    const mp4Parser = new TransformStream(this.mp4Parser);
    const decodeFramesStream = this.decodeFrames();
    const processDecodedFramesStream = this.processDecodedFrames();

    const videoStream = this.videoStream(this.videoTrack, bFramesTrack);
    videoStream
      .pipeThrough(parseRawFrames)
      .pipeThrough(reorderBuffer)
      .pipeThrough(mp4Parser)
      .pipeThrough(decodeFramesStream)
      .pipeTo(processDecodedFramesStream);
  }

  videoStream(videoTrack: ReadableStream, bFramesTrack: ReadableStream) {
    return new ReadableStream({
      async start(controller) {
        const videoReader = videoTrack.getReader();
        const bFramesReader = bFramesTrack.getReader();

        async function readVideoStream() {
          try {
            while (true) {
              const { done, value } = await videoReader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          } finally {
            videoReader.releaseLock();
          }
        }

        async function readBFramesStream() {
          try {
            while (true) {
              const { done, value } = await bFramesReader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          } finally {
            bFramesReader.releaseLock();
          }
        }

        readVideoStream();
        readBFramesStream();
      },
    });
  }

  processDecodedFrames() {
    // queue frame to render
    const queueNextFrame = async () => {
      if (this.playerState == "PAUSED") {
        return;
      }
      if (this.buffer.length === 0) {
        this.playerState = "BUFFERING";
        this.onBufferingStart();
        this.resumedPlayingAt = undefined;
        return;
      }
      const nextFrame = this.buffer.shift()!;

      // Based on the frame's timestamp calculate how much of real time waiting
      // is needed before showing the next frame.
      const timeUntilNextFrame = this.calculateTimeUntilFrame(
        nextFrame.videoFrame.timestamp,
      );
      await new Promise((r) => {
        setTimeout(r, timeUntilNextFrame);
      });

      this.renderFrame(nextFrame.videoFrame);

      // Calculate latency
      if (!this.firstFrameMediaTime) {
        this.firstFrameMediaTime = nextFrame.videoFrame.timestamp;
      }
      const latencyMs = this.calculateFrameLatency(nextFrame.videoFrame);
      this.logger.onRender(nextFrame, latencyMs);
      this.lastFrameRendered = nextFrame;

      nextFrame.videoFrame.close();
      queueNextFrame();
    };

    return new WritableStream<Frame>({
      write: (frame: Frame) => {
        if (this.playerState === "PAUSED") {
          return;
        }

        this.buffer.push(frame);
        const currBufferSizeMs = this.currentBufferSize();
        if (
          this.playerState === "BUFFERING" &&
          this.buffer.length > 0 &&
          currBufferSizeMs >= this.bufferSizeMs
        ) {
          this.playerState = "PLAYING";
          this.onBufferingEnd();
          queueNextFrame();
        }
      },
    });
  }

  calculateTimeUntilFrame(frameTimestamp: number) {
    if (this.resumedPlayingAt === undefined) {
      this.resumedPlayingAt = {
        localTime: performance.now(),
        mediaTime: frameTimestamp,
      };
    }

    // relative to since last pause or buffer event
    const relativeMediaTime =
      performance.now() - this.resumedPlayingAt.localTime;
    const relativeFramePresentationTime =
      (frameTimestamp - this.resumedPlayingAt.mediaTime) / 1000;
    return Math.max(0, relativeFramePresentationTime - relativeMediaTime);
  }
}
