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
        return await handleTorrent(torrent, m);
      }
      client.add(magnet, { path }, (torrent) => handleTorrent(torrent, m));
    },
  });
})();
async function handleTorrent(torrent, m) {
  let start = new Date().getTime();
  let a = await m.client.sendMessage(m.jid, {
    message: "Downloading torrent...\n" + torrent.name,
  });
  let prevText = "";
  const handleSendFile = async (file) => {
    console.log("file done", file.name);
    console.log("file path", file.path);
    await semaphore.acquire();
    const msg = await m.client.sendMessage(m.jid, {
      message: "file done\n" + file.name,
    });
    let start = new Date().getTime();
    let prevText = "";
    await m.client.send(
      m.jid,
      {
        document: {
          url: `${path}/${file.path}`,
        },
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
    semaphore.release();
    console.log(semaphore.count);
    try {
      fs.unlinkSync(`${path}/${file.path}`);
      await msg.delete({ revoke: true });
    } catch (error) {
      console.log(error);
    }
  };
  if (torrent.ready) {
    for (let file of torrent.files) {
      if (file.done) {
        handleSendFile(file);
      }
      file.once("done", async () => {
        handleSendFile(file);
      });
    }
  } else {
    torrent.once("metadata", () => {
      console.log("metadata", torrent.files);
      for (let file of torrent.files) {
        if (file.done) {
          handleSendFile(file);
        }
        file.once("done", async () => {
          await handleSendFile(file);
        });
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
    torrent.destroy();
    await a.edit({ text: "torrent finished downloading" });
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

module.exports = {handleTorrent}