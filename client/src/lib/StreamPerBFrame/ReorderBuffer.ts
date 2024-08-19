import { Logger } from "../Logger";
import { RawFrame } from "../types";

// ReorderBuffer ensures that frames are enqueued in order
export class ReorderBufferBFrames {
  private buffer: RawFrame[];
  private targetSize: number; // in the video timescale
  private logger: Logger;

  private lastEnqueued: RawFrame | undefined;

  constructor(buffer: RawFrame[], targetSize: number, logger: Logger) {
    this.buffer = buffer;
    this.targetSize = targetSize;
    this.logger = logger;
  }

  private bufferSize(): number {
    const oldest = this.buffer[0]?.dts ?? 0;
    const newest = this.buffer[this.buffer.length - 1]?.dts ?? 0;
    return newest - oldest;
  }

  private add(rawFrame: RawFrame) {
    this.buffer.push(rawFrame);
    this.buffer.sort((a, b) => a.dts - b.dts);
  }

  transform(
    rawFrame: RawFrame,
    controller: TransformStreamDefaultController<RawFrame>,
  ) {
    if (this.lastEnqueued && rawFrame.dts < this.lastEnqueued.dts) {
      this.logger?.onDrop(rawFrame);
      return;
    }

    this.add(rawFrame);

    while (this.bufferSize() > this.targetSize) {
      const next = this.buffer[0]!;
      // if B-frame is early, wait, because it might be ahead of I- or P-frames
      if (
        this.lastEnqueued &&
        next.frameType === "B" &&
        // TODO: use lastEnqueued.duration
        next.dts > this.lastEnqueued.dts + 512
      ) {
        break;
      }

      ensureInOrder(next, this.lastEnqueued);
      controller.enqueue(next);
      this.lastEnqueued = next;
      this.buffer.shift();
    }
  }
}

export function ensureInOrder(
  next: RawFrame,
  lastEnqueued: RawFrame | undefined,
) {
  if (lastEnqueued && next.dts - lastEnqueued.dts < 0) {
    console.log("frame: ", next);
    console.log("last enqueued: ", lastEnqueued);
    console.log("dts diff: ", next.dts - lastEnqueued.dts);
    throw Error("Player is about to enqueue a frame out of order.");
  }
}
