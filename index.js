const { BOT_TOKEN,DEVELOPMENT } = require("./config");
const {Bot} = require("./lib/Bot")
const commandsPromise = require('./commands');
const fs = require('fs');

const newBot = new Bot(BOT_TOKEN,"torrent")
//cleanup
if(!DEVELOPMENT){
  const dirs = fs.readdirSync('./')
  for(let dir of dirs){
    if(dir.startsWith('tor-')){
      fs.rmSync(dir,{recursive:true})
    }
  }
}
commandsPromise.then(commands => {
  for(let command of commands){
    newBot.addCommand(command)
  }
  newBot.init()
}).catch(console.error);

