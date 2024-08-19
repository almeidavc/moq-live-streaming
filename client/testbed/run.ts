import puppeteer from "puppeteer";
import { config } from "./config";
import fs from "node:fs";
import path from "node:path";
import { clean, parseProfile, simulateNetworkPattern } from "./simulateMacos";

const sigintHandler = () => {
  console.log("\nReceived SIGINT. Cleaning up...");
  clean();
  process.exit(0);
};

const networkProfile = parseProfile(config.networkProfile);

const browser = await puppeteer.launch({
  headless: false,
});
const page = await browser.newPage();
await page.goto("http://localhost:5173/test");
console.log(
  "Player has launched. Establishing MoQ session and subscribing to tracks...",
);
await page.exposeFunction("onInitialBufferingStart", () => {
  console.log(
    "Player subscribed to MoQ tracks successfully. Waiting for playback...",
  );
});
await page.exposeFunction("onPlaying", () => {
  console.log(
    "Stream is now playing. Waiting for 3 seconds of uninterrupted playback...",
  );
});

await page.exposeFunction("onReady", async () => {
  console.log("Beginning simulation...");
  process.on("SIGINT", sigintHandler);
  await simulateNetworkPattern(networkProfile);
  process.off("SIGINT", sigintHandler);
  console.log("Simulation done. Retrieving session metrics...");
  page.evaluate(() => {
    document.dispatchEvent(new Event("simulationDone"));
  });
});

await page.exposeFunction("onSimulationDone", async (metrics) => {
  console.log("Session metrics:");
  console.log(metrics);

  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  const profile = path.basename(config.networkProfile, ".json");
  const fileName = `${config.resultFilePrefix}_${date}_${time}_${profile}.json`;
  const filePath = `${config.resultsDir}/${fileName}`;

  await fs.promises.mkdir(config.resultsDir, { recursive: true });
  await fs.promises.writeFile(
    filePath,
    JSON.stringify({
      profile: networkProfile,
      metrics: metrics,
    }),
  );
  console.log(`Results saved to ${config.resultsDir}/${fileName}`);

  const uid = parseInt(process.env.SUDO_UID);
  const gid = parseInt(process.env.SUDO_GID);
  fs.chownSync(filePath, uid, gid);

  await browser.close();
});
