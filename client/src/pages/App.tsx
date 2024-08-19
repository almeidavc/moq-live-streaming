import { useEffect, useRef, useState } from "react";
import { Session } from "@mengelbart/moqjs";
import { LiveVideoCanvas } from "../components/LiveVideoCanvas";
import { StreamPerGop } from "../lib/StreamPerGop";
import { StreamPerBFrame } from "../lib/StreamPerBFrame";
import { Player } from "../lib/Player";

export async function establishMoqSession() {
  const certHashRes = await fetch(import.meta.env.VITE_CERT_HASH_URL);
  const certHash = await certHashRes.text();
  return Session.connect(import.meta.env.VITE_SERVER_URL, certHash);
}

function App() {
  const [session, setSession] = useState<Session>();
  const [player, setPlayer] = useState<Player>();

  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string>();
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamPlaying, setStreamPlaying] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);

  const [avgBitrate, setAvgBitrate] = useState<number>();

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    establishMoqSession()
      .then((session) => {
        setSession(session);
        const player = new StreamPerBFrame({
          session,
          renderFrame: (frame) => {
            const ctx = canvasRef.current?.getContext("2d");
            ctx?.drawImage(frame, 0, 0, 960, 540);
          },
        });
        setPlayer(player);
        player.addEventListener("bufferingStart", () => {
          setStreamLoading(false);
        });
        player.addEventListener("bufferingEnd", () => {});
        // player.addEventListener("avgBitrate", (e) => {
        //   setAvgBitrate(e.detail.avgBitrate);
        // });
      })
      .catch((err) => setSessionError(err.message))
      .finally(() => setSessionLoading(false));
  }, []);

  async function startWatching() {
    if (!session || !player || !canvasRef.current) {
      return;
    }

    setStreamPlaying(true);
    setStreamLoading(true);
    player.play();
    player.startLoggerSession();
  }

  async function stopWatching() {
    if (!player) {
      return;
    }
    player?.pause();
    setStreamPlaying(false);
    setStreamPaused(true);
  }

  function saveSessionMetrics() {
    console.log(player?.getSessionMetrics());
  }

  useEffect(() => {
    window.addEventListener("beforeunload", stopWatching);
    return () => {
      window.removeEventListener("beforeunload", stopWatching);
    };
  }, [session, stopWatching]);

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
      {streamPlaying ? (
        <button onClick={stopWatching} style={{ marginBottom: 16 }}>
          Stop stream
        </button>
      ) : (
        <button
          disabled={!session}
          onClick={startWatching}
          style={{ marginBottom: 16 }}
        >
          Watch stream
        </button>
      )}
      {streamLoading && <span>Stream loading...</span>}
      <LiveVideoCanvas ref={canvasRef} player={player} />
      {/* <span style={{ marginTop: 16 }}>
        Avg Bitrate: {avgBitrate ? avgBitrate + " Kbit/s" : "-"}
      </span> */}
      {streamPaused && (
        <button onClick={saveSessionMetrics} style={{ marginBottom: 16 }}>
          Save session metrics
        </button>
      )}
    </div>
  );
}

export default App;
