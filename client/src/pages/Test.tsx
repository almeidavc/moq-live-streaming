import { useEffect, useRef, useState } from "react";
import { Session } from "@mengelbart/moqjs";
import { Player } from "../lib/Player";
import { LiveVideoCanvas } from "../components/LiveVideoCanvas";
import { establishMoqSession } from "./App";
import { StreamPerGop } from "../lib/StreamPerGop";
import { StreamPerBFrame } from "../lib/StreamPerBFrame";

export function Test() {
  const [player, setPlayer] = useState<Player>();

  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string>();
  const [streamLoading, setStreamLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let player: Player;

    function onBufferingStart(e: CustomEvent) {
      if (!e.detail.isRebuffering) {
        // @ts-ignore: injected by puppeteer
        window.onInitialBufferingStart();
        setStreamLoading(false);
      }
    }
    function onBufferingEnd(e: CustomEvent) {
      if (!e.detail.isRebuffering) {
        // @ts-ignore: injected by puppeteer
        window.onPlaying();
        // wait 3 second of uninterrupted playback
        setTimeout(async () => {
          player.startLoggerSession();
          // @ts-ignore: injected by puppeteer
          await window.onReady();
        }, 3000);
      }
    }

    async function setup() {
      let session: Session;
      try {
        session = await establishMoqSession();
      } catch (e) {
        setSessionError(e.message);
        setSessionLoading(false);
        return;
      }
      setSessionLoading(false);

      player = new StreamPerGop({
        session,
        renderFrame: (frame) => {
          const ctx = canvasRef.current?.getContext("2d");
          ctx?.drawImage(frame, 0, 0, 960, 540);
        },
      });
      setPlayer(player);
      player.addEventListener("bufferingStart", onBufferingStart);
      player.addEventListener("bufferingEnd", onBufferingEnd);
      player.play();
    }
    setup();

    function onSimulationDone() {
      player.getSessionMetrics();
      player.pause();
      const metrics = player.getSessionMetrics();
      console.log(metrics);
      // @ts-ignore: injected by puppeteer
      window.onSimulationDone(metrics);
    }
    document.addEventListener("simulationDone", onSimulationDone);

    return () => {
      player.pause();
      player.removeEventListener("bufferingStart", onBufferingStart);
      player.removeEventListener("bufferingEnd", onBufferingEnd);
      document.removeEventListener("done", onSimulationDone);
    };
  }, []);

  useEffect(() => {
    const stop = () => player?.pause();
    window.addEventListener("beforeunload", stop);
    return () => {
      window.removeEventListener("beforeunload", stop);
    };
  }, [player]);

  if (sessionLoading) {
    return <span>Establishing MoQ session...</span>;
  }

  if (sessionError) {
    return <span>ERROR: {sessionError}</span>;
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "start" }}
    >
      {streamLoading && <span>Stream loading...</span>}
      <LiveVideoCanvas ref={canvasRef} player={player} />
    </div>
  );
}
