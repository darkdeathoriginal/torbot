const { TelegramClient, Api, Logger } = require("telegram");
const { NewMessage } = require("telegram/events");
const { CustomFile } = require("telegram/client/uploads");
const { LogLevel } = require("telegram/extensions/Logger");
const fs = require("fs");
const Message = require("./Message");
const EventEmitter = require("events");
const {sendFile} = require("./sendFile");
const {sendFile2} = require("./sendFile2");

async function createUrlFile(path, type = "image") {
  const result = new CustomFile(
    type == "image" ? "test.png" : "test.mp4",
    fs.statSync(path).size,
    path
  );
  return result;
}
async function createBufferFile(buffer, type = "image") {
  const result = new CustomFile(
    type == "image" ? "test.png" : "test.mp4",
    buffer.length,
    "",
    buffer
  );
  return result;
}
class CreateClient extends TelegramClient {
  constructor(stringSession, apiId, apiHash, options) {
    super(stringSession, apiId, apiHash, {
      ...options,
      connectionRetries: 5,
      baseLogger: new Logger(LogLevel.ERROR),
    });
    this._exportedSenderRefCounter = {}
    this._exportedSenderReleaseTimeouts1 = {};
    this.event = new EventEmitter();
    this.sendFile = (...params)=>sendFile2(this,...params)
    this.addEventHandler((event) => {
      let message = new Message(this, event.message);
      const type = message.quoted
        ? `${message.jid}-quoted-${message.quoted}`
        : `${message.jid}-message`;
      this.event.emit(type, message);
    }, new NewMessage({}));
  }
  async getReplyMessage(jid, quoted = false) {
    const type = quoted ? `${jid}-quoted-${quoted}` : `${jid}-message`;
    return new Promise((resolve, reject) => {
      this.event.once(type, (message) => {
        resolve(message);
      });
    });
  }
  async send(id, obj, options = {}) {
    try {
      if (obj.text) {
        return await this.sendMessage(id, {
          message: obj.text,
        });
      } else if (obj.image) {
        if (obj.image.url) {
          await this.sendFile(id, { file: await createUrlFile(obj.image.url) });
        } else {
          await this.sendFile(id, { file: await createBufferFile(obj.image) });
        }
      } else if (obj.video) {
        if (obj.video.url) {
          return await this.sendFile(id, {
            file: await createUrlFile(obj.video.url, "video"),
          });
        } else {
          return await this.sendFile(id, {
            file: await createBufferFile(obj.video, "video"),
          });
        }
      } else if (obj.document) {
        if (obj.document.url) {
          const result = new CustomFile(
            obj.fileName,
            fs.statSync(obj.document.url).size,
            obj.document.url
          );
          return await this.sendFile(id, {
            file: result,
            forceDocument: true,
            workers: 10,
            ...options,
          });
        } else {
          const result = new CustomFile(
            obj.fileName,
            obj.document.length,
            "",
            obj.document
          );
          return await this.sendFile(id, {
            file: result,
            forceDocument: true,
            workers: 10,
            ...options,
          });
        }
      } else {
        console.log("invalid format");
      }
    } catch (e) {
      throw e;
    }
  }
  async getUserProfilePhotos(userId) {
    return (
      await this.invoke(
        new Api.photos.GetUserPhotos({
          userId: userId,
          offset: 0,
        })
      )
    ).photos;
  }
  async uploadDocumentAction(jid) {
    return await this.invoke(
      new Api.messages.SetTyping({
        peer: jid,
        action: new Api.SendMessageUploadDocumentAction(),
      })
    );
  }
  async cancelAction(jid) {
    return await this.invoke(
      new Api.messages.SetTyping({
        peer: jid,
        action: new Api.SendMessageCancelAction(),
      })
    );
  }
  releaseExportedSender(sender) {
    const dcId = this.session.dcId;
    const index = sender._senderIndex;

    if (!this._exportedSenderRefCounter[dcId]) return;
    if (!this._exportedSenderRefCounter[dcId][index]) return;

    this._exportedSenderRefCounter[dcId][index] -= 1;

    if (this._exportedSenderRefCounter[dcId][index] <= 0) {
        if (!this._exportedSenderReleaseTimeouts1[dcId]) this._exportedSenderReleaseTimeouts1[dcId] = {};

        this._exportedSenderReleaseTimeouts1[dcId][index] = setTimeout(() => {
            // eslint-disable-next-line no-console
            if (this._shouldDebugExportedSenders) console.log(`[CC] [idx=${index} dcId=${dcId}] 🚪 Release`);
            sender.disconnect();
            this._exportedSenderReleaseTimeouts1[dcId][index] = undefined;
            this._exportedSenderPromises[dcId][index] = undefined;
        }, EXPORTED_SENDER_RELEASE_TIMEOUT);
    }
}

}
async function createBot(
  apiId,
  apiHash,
  botToken,
  stringSession,
  options = {}
) {
  let client = new CreateClient(stringSession, apiId, apiHash, options);
  await client.start({
    botAuthToken: botToken,
  });
  return client;
}
exports.createBot = createBot;
exports.CreateClient = CreateClient;
