import { useEffect, useState } from "react";
import { Player } from "../lib/Player";
import React from "react";

interface LiveVideoCanvasProps {
  player?: Player;
  showSpinner?: boolean;
}

export const LiveVideoCanvas = React.forwardRef<
  HTMLCanvasElement,
  LiveVideoCanvasProps
>(({ player, showSpinner = false }, ref) => {
  const [streamBuffering, setStreamBuffering] = useState(false);

  useEffect(() => {
    if (!showSpinner) return;
    const handleBufferingEvent = (event: any) => {
      setStreamBuffering(event.type === "bufferingStart");
    };
    player?.addEventListener("bufferingStart", handleBufferingEvent);
    player?.addEventListener("bufferingEnd", handleBufferingEvent);
    return () => {
      player?.removeEventListener("bufferingStart", handleBufferingEvent);
      player?.removeEventListener("bufferingEnd", handleBufferingEvent);
    };
  }, [player, showSpinner]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={ref}
        style={{ background: "black" }}
        width={960}
        height={540}
      />
      {showSpinner && streamBuffering && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "black",
            opacity: 0.7,
            color: "white",
          }}
        >
          <span>Buffering...</span>
        </div>
      )}
    </div>
  );
});
