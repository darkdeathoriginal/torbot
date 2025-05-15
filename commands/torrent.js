const { Semaphore } = require("../lib/helpers");
const { addCommand } = require("..");
const fs = require("fs");

const semaphore = new Semaphore(2);
const torrentSemaphore = new Semaphore(3)

const { execFile } = require("child_process");
const Path = require("path");
const config = require("../config");
const { DataTypes } = require("sequelize");
const { handleTorrentAdd } = require("../lib/torrent");

const cacheChannel = "-1002298365533";

addCommand({
  pattern: "torrent",
  description: "torrent <magnet link> - Download torrent file",
  sudo: true,
  callback: async (m, match, obj) => {
    const magnet = match[1];
    if (!magnet) {
      await m.client.sendMessage(m.jid, {
        message: "Please provide a magnet link.",
      });
      return;
    }
    handleTorrentAdd(magnet, m)
  },
});


