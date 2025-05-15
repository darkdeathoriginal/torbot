const { Api } = require("telegram/index");
const { StoreSession, StringSession } = require("telegram/sessions");
const { NewMessage, Raw} = require("telegram/events");
const { CallbackQuery } = require("telegram/events/CallbackQuery");
const  Callback  = require("./Callback");
const Message = require("./Message");
const { createBot } = require("./createClient");
const { apiId, apiHash, DEVELOPMENT, sudo,DATABASE } = require("../config");
const { DataTypes } = require("sequelize");



class Bot {
  constructor(BOT_TOKEN, name) {
    this.BOT_TOKEN = BOT_TOKEN;
    this.name = name;
    this.modules = [];
  }
  async init() {
    console.log(`${this.name} is starting...`);
    const session = await getStingSession(this.name);
    const stringSession = new StringSession(session);

    this.client = await createBot(
      apiId,
      apiHash,
      this.BOT_TOKEN,
      stringSession
    );
    const sessionString = this.client.session.save();
    setStringSession(this.name, sessionString);
    await this.setCommands();
    console.log(`${this.name} started!`);
    for(let module of this.modules){
      if(module.on && module.on == "start" && module.callback) module.callback(this.client)
    }
    try {
    if(!isNaN(sudo)){
      this.client.send(sudo,{text:`${this.name} started!`})

    }      
    } catch (error) {
      console.log(error);
    }
    this.client.addEventHandler(async (event) => {
      let test = new Message(this.client, event.message);
      for (let i of this.modules) {
        if (i.pattern && ((i.sudo && sudo == test.jid) || !i.sudo)) {
          const regex = new RegExp(`^\/\\s*${i.pattern} ?(.*)`);
          const match = event.message?.message?.match(regex);

          if (match) {
            i.callback(test, match, this);
          }
        }
        if (
          i.on &&
          i.on == "message" &&
          ((i.sudo && sudo == test.jid) || !i.sudo)
        ) {
          i.callback(test, [], this);
        }
      }
    }, new NewMessage({}));
    this.client.addEventHandler(async (event) => {
      const callback = new Callback(this.client,event.query);
      for(let module of this.modules){
        if(module.on && module.on == "callback_query" && module.callback){
          module.callback(callback, this.client)
        }
      }
    }, new CallbackQuery({}));
    await this.client.getMe();
    this.client.addEventHandler((event)=>{
      if (event instanceof Api.UpdateBotInlineQuery) {
        for(let module of this.modules){
          if(module.on && module.on == "inline_query" && module.callback){
            module.callback(event, this.client)
          }
        }
      }
    },new Raw({}))
  }
  addCommand(command) {
    this.modules.push(command);
  }
  async setCommands() {
    const commands = [];
    for (let i of this.modules) {
      if (i.pattern && i.description&& !i.dontAdd) {
        commands.push(
          new Api.BotCommand({
            command: i.pattern,
            description: i.description,
          })
        );
      }
    }
    await this.client.invoke(
      new Api.bots.SetBotCommands({
        scope: new Api.BotCommandScopeDefault(),
        langCode: "en",
        commands,
      })
    );
  }
}

async function getStingSession(name) {
  await DATABASE.sync();
  const session = await sessionDb.findOne({ where: { name } });
  if (session) {
    return session.session;
  } else {
    return ""
  }
}
async function setStringSession(name,session){
  await DATABASE.sync();
  const dbSession = await sessionDb.findOne({ where: { name } });
  if (dbSession) {
    await sessionDb.update({ session }, { where: { name } });
  } else {
    await sessionDb.create({ session, name });
  }
}

const sessionDb = DATABASE.define("session", {
  session: {
    type: DataTypes.TEXT,
  },
  name: {
    type: DataTypes.TEXT,
  },
})

exports.Bot = Bot;
