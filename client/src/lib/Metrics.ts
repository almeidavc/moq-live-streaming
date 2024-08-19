import { SessionLogs } from "./Logger";
import { FrameType } from "./types";

type SessionMetrics = {
  avgLatency: number;
  avgBufferingTime: number;
  totalBufferingEvents: number;
  // avgReceivedBitrate: number;
  totalReceived: number;
  framesReceivedByType: Record<FrameType, number>;

  totalFramesDropped: number;
  framesDropped: SessionLogs["framesDropped"];

  bufferingEvents: SessionLogs["bufferingEvents"];
  renderedData: SessionLogs["rendered"];
  // receivedBitrate: ReturnType<typeof calculateReceivedBitrate>;
};

export function calculateMetrics(logs: SessionLogs): SessionMetrics {
  // Calculate average latency
  const rendered = Object.values(logs.rendered);
  const avgLatency =
    rendered.reduce((sum, frame) => sum + frame.latencyMs, 0) / rendered.length;

  // Calculate average buffering time and total buffering events
  let totalBufferingTime = 0;
  let bufferingEventsCount = 0;
  let bufferingStartTimestamp: number | null = null;

  logs.bufferingEvents.forEach((event) => {
    if (event.type === "bufferingStart") {
      bufferingStartTimestamp = event.timestamp;
      bufferingEventsCount += 1;
    } else if (
      event.type === "bufferingEnd" &&
      bufferingStartTimestamp !== null
    ) {
      totalBufferingTime += event.timestamp - bufferingStartTimestamp;
      bufferingStartTimestamp = null;
    }
  });

  const avgBufferingTime =
    bufferingEventsCount > 0 ? totalBufferingTime / bufferingEventsCount : 0;

  const totalReceived =
    logs.mediaReceived.reduce(
      (sum, object) => sum + object.payloadSize * 8,
      0,
    ) / 1000;

  const endTime = logs.mediaReceived[logs.mediaReceived.length - 1].receivedAt;
  const startTime = logs.mediaReceived[0].receivedAt;
  const durationInSeconds = (endTime - startTime) / 1000;
  const avgReceivedBitrate = totalReceived / durationInSeconds;
  const framesReceivedByType = logs.mediaReceived.reduce(
    (acc, entry) => {
      const { frameType } = entry;
      acc[frameType] = (acc[frameType] || 0) + 1;
      return acc;
    },
    {} as Record<FrameType, number>,
  );

  return {
    avgLatency,
    avgBufferingTime,
    totalBufferingEvents: bufferingEventsCount,
    // avgReceivedBitrate,
    totalReceived,
    framesReceivedByType,

    totalFramesDropped: logs.framesDropped.length,
    framesDropped: logs.framesDropped,

    bufferingEvents: logs.bufferingEvents,
    renderedData: logs.rendered,
    // receivedBitrate: calculateReceivedBitrate(logs.mediaReceived),
  };
}

function calculateReceivedBitrate(mediaReceived: SessionLogs["mediaReceived"]) {
  // Sort mediaReceived by receivedAt
  mediaReceived.sort((a, b) => a.receivedAt - b.receivedAt);

  // Group payloads by each second
  const bitrateMap: Record<number, number> = {};
  mediaReceived.forEach((entry) => {
    const second = Math.floor(entry.receivedAt / 1000); // convert to seconds
    if (!bitrateMap[second]) {
      bitrateMap[second] = 0;
    }
    bitrateMap[second] += entry.payloadSize;
  });

  // Convert payload sizes to bits and create bitrate entries
  const bitrateEntries = [];
  for (const second in bitrateMap) {
    const bitrate = (bitrateMap[second] * 8) / 1000; // bytes to bits
    bitrateEntries.push({ second: Number(second), bitrate });
  }

  // Sort the result by second
  bitrateEntries.sort((a, b) => a.second - b.second);

  return bitrateEntries;
}

// function calculateQoE(sessionMetrics: SessionLogs) {}
