import { loadEnv } from "./config/loadEnv.js";
loadEnv();
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { migrate } from "./db/migrate.js";

async function main(): Promise<void> {
  const ran = await migrate();
  if (ran.length) console.log(`Applied migrations: ${ran.join(", ")}`);
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
