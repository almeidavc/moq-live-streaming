import * as fs from "fs";
import { execSync } from "child_process";

const PF_RULES = "./pf_rules.txt";
const PF_ANCHOR = "streaming-testbed";

function setup() {
  execSync(`dnctl pipe 5000 config`);
  execSync(`dnctl pipe 5001 config`);
  execSync(`pfctl -q -a ${PF_ANCHOR} -f ${PF_RULES}`);
}

function configureBwLimit(bwLimitKbit: number) {
  execSync(`dnctl pipe 5000 config bw ${bwLimitKbit}Kbit/s`);
}

function configureDelay(delayMs: number) {
  execSync(`dnctl pipe 5000 config delay ${delayMs}ms`);
}

export function clean() {
  execSync(`pfctl -q -a ${PF_ANCHOR} -F all`);
  execSync(`dnctl pipe 5000 delete`);
  execSync(`dnctl pipe 5001 delete`);
}

export function parseProfile(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw Error(`Profile file ${file} not found!`);
    }
    throw Error(`Error decoding JSON from file ${file}: ${err}`);
  }
}

export async function simulateNetworkPattern(profile: any) {
  setup();

  const sigintHandler = () => {
    console.log("\nReceived SIGINT. Cleaning up...");
    clean();
    process.exit(0);
  };
  process.on("SIGINT", sigintHandler);

  try {
    for (const item of profile) {
      const speed = item.speed;
      const duration = item.duration;
      configureBwLimit(speed);
      console.log(`Sleeping for ${duration} seconds...`);
      await new Promise((r) => setTimeout(r, item.duration * 1000));
    }
  } catch (err) {
    console.error(`An error occurred: ${err}`);
  } finally {
    process.off("SIGINT", sigintHandler);
    clean();
  }
}
