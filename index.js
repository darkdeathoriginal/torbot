const { BOT_TOKEN, DEVELOPMENT } = require("./config");
const { Bot } = require("./lib/Bot");
const fs = require("fs");

const newBot = new Bot(BOT_TOKEN, "torrent");
//cleanup
if (!DEVELOPMENT) {
  const dirs = fs.readdirSync("./");
  for (let dir of dirs) {
    if (dir.startsWith("tor-")) {
      fs.rmSync(dir, { recursive: true });
    }
  }
  //clear empty folders
  setInterval(() => {
    const dirs = fs.readdirSync("./");
    for (let dir of dirs) {
      if (dir.startsWith("tor-")) {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmSync(dir, { recursive: true });
        }
      }
    }
  }, 1000 * 60 * 60 * 12);
}

module.exports = { addCommand: newBot.addCommand.bind(newBot) };

for (const file of fs.readdirSync("./commands")) {
  if (file.endsWith(".js")) {
    require(`./commands/${file}`);
  }
}
newBot.init();
