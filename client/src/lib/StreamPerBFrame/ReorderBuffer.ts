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

  enqueueNext(controller: TransformStreamDefaultController<RawFrame>) {
    const next = this.buffer.shift()!;
    ensureInOrder(next, this.lastEnqueued);
    controller.enqueue(next);
    this.lastEnqueued = next;
  }

  transform(
    rawFrame: RawFrame,
    controller: TransformStreamDefaultController<RawFrame>,
  ) {
    // drop any late B-frames
    if (this.lastEnqueued && rawFrame.dts < this.lastEnqueued.dts) {
      if (rawFrame.frameType !== "B") {
        throw new Error("Enqueued a frame ahead of an I-, or P-frame.");
      }
      this.logger?.onDrop(rawFrame);
      return;
    }

    this.add(rawFrame);

    while (this.bufferSize() > this.targetSize) {
      const next = this.buffer[0]!;
      if (
        next.frameType !== "B" ||
        !this.lastEnqueued ||
        // TODO: use lastEnqueued.duration
        next.dts === this.lastEnqueued.dts + 512
      ) {
        this.enqueueNext(controller);
        continue;
      }

      // B-frame is early
      let i = 1;
      while (i < this.buffer.length && this.buffer[i]?.frameType === "B") i++;
      if (i < this.buffer.length) {
        // B-frame is not ahead of any I-, or P-frames (I-, P-frames are transmitted in order)
        this.enqueueNext(controller);
      } else {
        // B-frame might be ahead of I-, or P-frames, so wait
        break;
      }
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
