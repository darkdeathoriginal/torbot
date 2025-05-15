const { BOT_TOKEN, DEVELOPMENT } = require("./config");
const { Bot } = require("./lib/Bot");
const fs = require("fs");
const { handleTorrentAdd } = require("./lib/torrent");

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
newBot.init().then(() => {
//start http client to get chatid and magneturl
const http = require("http");
const PORT = 8080;
const server = http.createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const { chatId, magnetUrl } = JSON.parse(body);
      handleTorrentAdd(magnetUrl,{
        jid:chatId,
        client:newBot.client
      })
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
  }
  if(req.method === "GET"){
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Server is running");
  }
});
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
})
