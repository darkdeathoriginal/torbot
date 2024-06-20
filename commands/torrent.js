const fs = require("fs");
const { Semaphore } = require("../lib/helpers");
const { addCommand } = require("..");
const semaphore = new Semaphore(2);

(async () => {
  const WebTorrent = (await import("webtorrent")).default;

  const client = new WebTorrent();
  addCommand({
    pattern: "torrent",
    description: "torrent <magnet link> - Download torrent file",
    sudo: true,
    callback: async (m, match, obj) => {
      const magnet = match[1];
      const path = "tor-" + magnet.split(":")[3].split("&")[0];
      const torrent = await client.get(magnet);
      if (torrent) {
        return await handleTorrent(torrent, m, path);
      }
      client.add(magnet, { path,destroyStoreOnDestroy: true }, (torrent) =>
        handleTorrent(torrent, m, path)
      );
    },
  });
})();
async function handleTorrent(torrent, m, path, clearMsg = false) {
  let start = new Date().getTime();
  let a = await m.client.sendMessage(m.jid, {
    message: "Downloading torrent...\n" + torrent.name,
  });
  let prevText = "";
  const handleSendFile = async (file,usepath=false) => {
    console.log("file done", file.name);
    console.log("file path", file.path);
    await semaphore.acquire();
    const msg = await m.client.sendMessage(m.jid, {
      message: "file done\n" + file.name,
    });
    let start = new Date().getTime();
    let prevText = "";
    const document = usepath?{url:`${path}/${file.path}`}:{iterator:file,size:file.size}
    try {
      await m.client.send(
        m.jid,
        {
          document,
          fileName: file.name,
        },
        {
          progressCallback: async (p) => {
            const now = new Date().getTime();
            if (now - start < 10000) return;
            start = now;
            const text = `Uploading ${file.name}\nprogress: ${(p * 100).toFixed(
              2
            )}%`;
            if (prevText === text) return;
            prevText = text;
            try {
              await msg.edit({ text });
            } catch (error) {
              console.log(error);
            }
          },
        }
      );
      try {
        await msg.delete({ revoke: true });
      } catch (error) {
        console.log(error);
      }
      if(file.done){
        fs.unlinkSync(`${path}/${file.path}`);
      }
      else{
        file.once("done",()=>fs.unlinkSync(`${path}/${file.path}`))
      }
    } catch (error) {
      await msg.edit({
        text: "An error occured while uploading..\n" + error.message,
      });
      console.log(error);
      if(!usepath){
        await msg.delete({ revoke: true });
        if(file.done){
          await handleSendFile(file,true)
        }
        else{
          await new Promise((resolve,reject)=>{
            file.once("done",async()=>{
              await handleSendFile(file,true)
              resolve()
            })
          })
        }
      }
    } finally {
      semaphore.release();
    }
  };
  if (torrent.ready) {
    const promises = [];
    for (let file of torrent.files) {
      if(file.done){
        promises.push(handleSendFile(file,true))
      }
      else{
        // file.once("done",()=>handleSendFile(file,true))
        promises.push(handleSendFile(file))
      }
    }
    Promise.all(promises).then(()=>torrent.destroy())
  } else {
    torrent.once("metadata", () => {
      console.log("metadata", torrent.files);
      for (let file of torrent.files) {
        handleSendFile(file)
      }
    });
  }
  torrent.on("download", async (bytes) => {
    const now = new Date().getTime();
    if (now - start < 10000) return;
    if (torrent.progress === 1) return;
    start = now;
    console.log("just downloaded: " + bytes);
    console.log("total downloaded: " + torrent.downloaded);
    console.log("download speed: " + torrent.downloadSpeed);
    console.log("progress: " + torrent.progress);
    const timeInSec = torrent.timeRemaining / 1000;
    const formatedTime =
      torrent.timeRemaining < 0
        ? "calculating..."
        : timeInSec < 60
        ? `${timeInSec.toFixed(0)}s`
        : timeInSec < 3600
        ? `${(timeInSec / 60).toFixed(0)}m`
        : timeInSec < 3600 * 24
        ? `${(timeInSec / 3600).toFixed(0)}h`
        : `${(timeInSec / 3600 / 24).toFixed(0)}d`;
    const text = `${torrent.name}\nDownload speed: ${(
      torrent.downloadSpeed /
      1024 /
      1024
    ).toFixed(2)}Mb/s\nProgress: ${(torrent.progress * 100).toFixed(
      2
    )}%\nTime remaining : ${formatedTime}`;
    if (prevText === text) return;
    prevText = text;
    try {
      await a.edit({ text });
    } catch (error) {
      console.log(error);
    }
  });
  const handleDone = async () => {
    console.log("torrent finished downloading");
    await a.edit({ text: "torrent finished downloading" });
    if (clearMsg) {
      await a.delete({ revoke: true });
    }
  };
  if (torrent.done) {
    return await handleDone();
  }
  torrent.once("done", handleDone);
  torrent.once("error", async (err) => {
    console.log("torrent error", err);
    torrent.destroy();
    await a.edit({ text: "torrent error" });
  });
  torrent.once("metadata", async () => {
    console.log("torrent metadata");
  });
}

module.exports = { handleTorrent };
