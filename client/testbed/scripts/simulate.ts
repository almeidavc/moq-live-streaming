import { config } from "../config";
import { parseProfile, simulateNetworkPattern } from "../simulateMacos";

const args = process.argv.slice(2);
const profileFilePath = args.length > 0 ? args[0] : config.networkProfile;

const profile = parseProfile(profileFilePath);
simulateNetworkPattern(profile)
  .then(() => {
    console.log("Network simulation completed successfully.");
  })
  .catch((error) => {
    console.error("An error occurred during network simulation:", error);
    process.exit(1);
  });
