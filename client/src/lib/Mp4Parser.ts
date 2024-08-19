import * as MP4Box from "mp4box";
import { ParsedFrame, RawFrame } from "./types";
import { Logger } from "./Logger";

type VideoTrack = {
  id: string;
  codec: string;
  width: number;
  height: number;
  timescale: number;
};

export type Mp4Info = {
  videoTrack: VideoTrack;
};

export class Mp4Parser {
  logger: Logger;

  mp4boxFile: any;
  videoTrack: VideoTrack | undefined;
  ready: boolean = false;
  offset: number | undefined;
  queue: RawFrame[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  configure(init: Uint8Array): Promise<Mp4Info> {
    return new Promise((resolve, reject) => {
      this.mp4boxFile = MP4Box.createFile();
      this.mp4boxFile.onReady = (info: any) => {
        console.log("mp4 info", info);
        this.videoTrack = {
          id: info.videoTracks[0].id,
          codec: info.videoTracks[0].codec,
          width: info.videoTracks[0].width,
          height: info.videoTracks[0].height,
          timescale: info.videoTracks[0].timescale,
        };
        this.ready = true;
        resolve({ videoTrack: this.videoTrack });
      };
      this.mp4boxFile.onError = (err) => {
        reject(err);
      };
      const initBuffer = init.buffer;
      initBuffer.fileStart = 0;
      this.mp4boxFile.appendBuffer(initBuffer);
      this.mp4boxFile.flush();
      this.offset = init.byteLength;
    });
  }

  start(controller: TransformStreamDefaultController<ParsedFrame>) {
    if (!this.ready) {
      throw new Error("Mp4Parser not ready");
    }

    this.mp4boxFile.onSamples = (d1, d2, [frame]) => {
      const rawFrame = this.queue.shift()!;
      controller.enqueue({ ...frame, _pts: rawFrame.pts });
      this.logger.onExtract(rawFrame);
    };
    this.mp4boxFile.setExtractionOptions(this.videoTrack!.id, undefined, {
      nbSamples: 1,
    });
    this.mp4boxFile.start();
  }

  transform(rawFrame: RawFrame) {
    if (!this.ready) {
      throw new Error("Mp4Parser not ready");
    }

    this.queue.push(rawFrame);
    const frameBuffer = rawFrame.data;
    frameBuffer.fileStart = this.offset;
    this.offset += frameBuffer.byteLength;
    this.mp4boxFile.appendBuffer(frameBuffer);
    this.mp4boxFile.flush();
  }
}
