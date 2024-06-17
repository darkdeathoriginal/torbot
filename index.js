const { BOT_TOKEN } = require("./config");
const {Bot} = require("./lib/Bot")
const commandsPromise = require('./commands');

const newBot = new Bot(BOT_TOKEN,"torrent")

commandsPromise.then(commands => {
  for(let command of commands){
    newBot.addCommand(command)
  }
  newBot.init()
}).catch(console.error);

