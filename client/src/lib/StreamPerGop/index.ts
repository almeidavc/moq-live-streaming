import { SkipOldGops } from "./SkipOldGops";
import { Player, PlayerProps, StartAt } from "../Player";
import { Frame } from "../types";

export class StreamPerGop extends Player {
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
    this.videoTrack = await videoTrackSub.readableStream;

    const parseRawFrames = this.parseRawFrames();
    const skipOldGops = new TransformStream(new SkipOldGops());
    const mp4Parser = new TransformStream(this.mp4Parser);
    const decodeFramesStream = this.decodeFrames();
    const processDecodedFramesStream = this.processDecodedFrames();

    this.videoTrack
      .pipeThrough(parseRawFrames)
      .pipeThrough(skipOldGops)
      .pipeThrough(mp4Parser)
      .pipeThrough(decodeFramesStream)
      .pipeTo(processDecodedFramesStream);
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
        nextFrame.pts,
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

  calculateTimeUntilFrame(frameTimestamp: number, pts: number) {
    if (this.resumedPlayingAt === undefined) {
      this.resumedPlayingAt = {
        localTime: performance.now(),
        mediaTime: frameTimestamp,
      };
    }

    // if we receive a new GoP render I-frame instantly and update resumedPlayingAt
    if (this.lastFrameRendered && pts > this.lastFrameRendered.pts + 512) {
      this.resumedPlayingAt = {
        localTime: performance.now(),
        mediaTime: frameTimestamp,
      };
      return 0;
    }

    // relative to since last pause or buffer event
    const relativeMediaTime =
      performance.now() - this.resumedPlayingAt.localTime;
    const relativeFramePresentationTime =
      (frameTimestamp - this.resumedPlayingAt.mediaTime) / 1000;
    return Math.max(0, relativeFramePresentationTime - relativeMediaTime);
  }
}
