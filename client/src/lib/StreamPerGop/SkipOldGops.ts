import { ensureInOrder } from "../StreamPerBFrame/ReorderBuffer";
import { RawFrame } from "../types";

export class SkipOldGops {
  private lastEnqueued: RawFrame | undefined;

  transform(
    rawFrame: RawFrame,
    controller: TransformStreamDefaultController<RawFrame>,
  ) {
    if (this.lastEnqueued && rawFrame.dts < this.lastEnqueued.dts) {
      console.log("dropping late frame: ", rawFrame);
      return;
    }

    ensureInOrder(rawFrame, this.lastEnqueued);
    this.lastEnqueued = rawFrame;
    controller.enqueue(rawFrame);
  }
}
