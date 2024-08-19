export type FrameType = "P" | "B" | "I";

export type FrameInfo = {
  frameType: FrameType;
  pts: number;
  dts: number;
};

export type RawFrame = FrameInfo & {
  availabilityTime: number;
  data: ArrayBuffer;
};

export type ParsedFrame = {
  description: any;
  is_sync: boolean;
  timescale: number;
  duration: number;
  _pts: number;
  data: Uint8Array;
};

export type Frame = FrameInfo & {
  videoFrame: VideoFrame;
};
