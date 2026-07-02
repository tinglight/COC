import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { BotStorage } from "./storage.js";

const config = loadConfig();
const storage = new BotStorage(config.databasePath);
const app = createApp({ config, storage });

if (config.appId === "" || config.appSecret === "") {
  app.log.warn("QQ_APP_ID/QQ_APP_SECRET is empty. Fill .env before connecting to QQ.");
}

const close = async (): Promise<void> => {
  app.log.info("Shutting down");
  await app.close();
  storage.close();
};

process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

await app.listen({ port: config.port, host: "0.0.0.0" });
