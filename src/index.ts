import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = await buildBot(token);
  // /gift is the product's documented immediate-giveaway shortcut; menus remain
  // the primary surface for everyone else.
  await setDefaultCommands(bot, [{ command: "gift", description: "Разыграть подарок сейчас" }]);
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
