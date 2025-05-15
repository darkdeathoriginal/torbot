const { DataTypes } = require("sequelize");
const config = require("../config");
const { Semaphore } = require("./helpers");
const fs = require("fs");
const Path = require("path");
const { execFile } = require("child_process");
const cacheChannel = "-1002298365533";


const semaphore = new Semaphore(2);
const torrentSemaphore = new Semaphore(3)
let webClient;

async function getWebClient() {
  if (webClient) return webClient;
  const WebTorrent = (await import("webtorrent")).default;
  webClient = new WebTorrent();
  return webClient;
}


async function handleTorrentAdd(magnet, m) {  
    await torrentSemaphore.acquire();
    const path = "tor-" + magnet.split(":")[3].split("&")[0];
    const client = await getWebClient();
    const torrent = await client.get(magnet);
    if (torrent) {
      return await handleTorrent(torrent, m, path,true);
    }
    client.add(magnet, { path }, (torrent) => {
      handleTorrent(torrent, m, path,true);
    });
  }
  
  async function handleTorrent(torrent, m, path, clearMsg = false) {  
    let start = new Date().getTime();
    let a = await m.client.sendMessage(m.jid, {
      message: `Torrent "${torrent.name}" metadata received. Preparing download...`,
    });
    let prevText = "";
    let selectedFile;
  
    // --- Modified handleSendFile: Remove arrayBuffer, return Promise ---
    const handleSendFile = (file) => {
      // Return a promise to signal completion/failure
      return new Promise(async (resolve, reject) => {
        console.log("Processing file:", file.name);
        const document = Path.join(path, file.path); // Use Path.join for cross-platform compatibility
        console.log("File path:", document);
  
        // *** REMOVED: await file.arrayBuffer({}) ***
  
        try {
          await semaphore.acquire(); // Ensure semaphore is defined globally or passed in
  
          // Send status message *before* executing Go binary
          const statusMsg = `Sending file: ${file.name}`;
          console.log(statusMsg);
  
          const goBinary = Path.resolve(__dirname, "../main"); // Ensure this path is correct
  
          execFile(goBinary, [m.jid, document], async (error, stdout, stderr) => {
            semaphore.release();
  
            // --- File Deletion Logic ---
            const deleteFile = () => {
              try {
                if (fs.existsSync(document)) {
                  fs.unlinkSync(document);
                  console.log(`Deleted ${document}`);
                } else {
                  console.warn(`File not found for deletion: ${document}`);
                }
              } catch (unlinkErr) {
                console.error(`Error deleting file ${document}:`, unlinkErr);
                // Decide if failure to delete should reject the promise
                // reject(unlinkErr); // Option: Reject if deletion fails
              }
            };
  
            if (error) {
              console.error(
                `Go process error for ${file.name}: ${stderr || error.message}`
              );
              deleteFile(); // Attempt deletion even on Go error to save space
              reject(
                new Error(
                  `Go process failed for ${file.name}: ${stderr || error.message}`
                )
              ); // Reject the promise
              return;
            }
  
            console.log(`Go process stdout for ${file.name}: ${stdout}`); // File sent successfully
            const chat = stdout;
            console.log(chat);
  
            await cacheFile(file.name, file.length, chat, m.client, m.jid);
            deleteFile(); // Delete after successful processing
            resolve(); // Resolve the promise on success
          });
        } catch (err) {
          // Catch errors from semaphore or sendMessage
          console.error(
            `Error in handleSendFile for ${file.name} before execFile:`,
            err
          );
          if (semaphore?.isLocked()) {
            // Release semaphore if acquired before error
            semaphore.release();
          }
          // Attempt to delete file if it exists, as processing failed
          try {
            if (fs.existsSync(document)) {
              fs.unlinkSync(document);
              console.log(`Deleted ${document} after error during send setup.`);
            }
          } catch (unlinkErr) {
            console.error(
              `Error deleting file ${document} after send setup error:`,
              unlinkErr
            );
          }
          reject(err); // Reject the promise
        }
      });
    };
  
    const downloadAndProcessFilesSequentially = async (files) => {
      console.log("Starting sequential download process...");
      // Deselect all files initially
      console.log("Deselecting all files.");
      torrent.files.forEach((f) => f.deselect());
  
      // Filter out any zero-byte files or files you might want to skip
      const filesToProcess = files.filter((f) => f.length > 0);
      if (filesToProcess.length !== files.length) {
        console.log(
          `Skipping ${
            files.length - filesToProcess.length
          } zero-byte or filtered files.`
        );
      }
  
      let totalFiles = filesToProcess.length;
      let processedCount = 0;
  
      for (const file of filesToProcess) {
        processedCount++;
        console.log(
          `\n--- [${processedCount}/${totalFiles}] Selecting file: ${
            file.name
          } (${(file.length / 1024 / 1024).toFixed(2)} MB) ---`
        );
        await a
          .edit({
            text: `[${processedCount}/${totalFiles}] Downloading: ${file.name}`,
          })
          .catch((e) => console.log("Edit failed:", e)); // Update status
  
        await FileCacheDb.sync();
        const cached = await FileCacheDb.findOne({
          where: {
            name: file.name,
            size: file.length,
          },
        });
  
        if (cached) {
          const ids = cached.msgId
            .split(",")
            .filter((i) => i)
            .map(Number);
          const messages = await m.client.getMessages(cacheChannel, {
            ids,
          });
          for (const message of messages) {
            await m.client.sendMessage(m.jid, {
              message: message,
            });
          }
          continue;
        }
        file.select(); // Tell the client to download *this* file
  
        // Wait for the file to be fully downloaded
        if (!file.done) {
          selectedFile = file; // Store the selected file
          console.log(`Waiting for ${file.name} to download...`);
          await new Promise((resolve, reject) => {
            const onDone = () => {
              console.log(`File ${file.name} finished downloading.`);
              file.removeListener("error", onError); // Clean up error listener
              resolve();
            };
            const onError = (err) => {
              console.error(`Error downloading ${file.name}:`, err);
              file.removeListener("done", onDone); // Clean up done listener
              // Decide if you want to stop the whole process or skip the file
              reject(
                new Error(`Failed to download ${file.name}: ${err.message}`)
              );
            };
            file.once("done", onDone);
            file.once("error", onError); // Add error handling for download
          });
        } else {
          console.log(`File ${file.name} was already downloaded.`);
        }
  
        // Process (send) the file and wait for it to complete (including deletion)
        try {
          await a
            .edit({
              text: `[${processedCount}/${totalFiles}] Sending: ${file.name}`,
            })
            .catch((e) => console.log("Edit failed:", e)); // Update status
          await handleSendFile(file); // This now returns a promise
          console.log(`File ${file.name} processed and deleted successfully.`);
        } catch (error) {
          console.error(`Failed to process/send file ${file.name}:`, error);
          await a
            .edit({
              text: `[${processedCount}/${totalFiles}] Error sending: ${file.name}. Skipping.`,
            })
            .catch((e) => console.log("Edit failed:", e));
        }
      }
  
      console.log("All files processed sequentially.");
      await a.edit({ text: `Torrent "${torrent.name}" processed successfully.` });
      if (clearMsg) {
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait a bit before deleting
        await a
          .delete({ revoke: true })
          .catch((err) => console.error("Failed to delete final message:", err));
      }
      torrentSemaphore.release(); // Release semaphore after processing
      torrent.destroy(() => console.log("Torrent destroyed.")); // Clean up torrent resources
    };
  
    // --- Torrent Event Listeners ---
  
    torrent.on("download", (bytes) => {
      // Progress reporting might be less accurate for the *overall* torrent now,
      // as it reflects progress on the *currently selected* file primarily.
      const now = new Date().getTime();
      if (now - start < 20000) return; // Update interval (e.g., 5 seconds)
      start = now;
  
      // Calculate progress based on selected files or overall bytes might be complex.
      // A simpler approach might be to show speed and current file.
      const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
      // Find the currently selected and downloading file (may need more robust logic)
      const currentFile = selectedFile;
      if(currentFile?.done) return
      const currentFileName = currentFile ? currentFile.name : "connecting...";
      const fileProgress = currentFile
        ? (currentFile.progress * 100).toFixed(1)
        : "0";
  
      // You could try and calculate overall progress based on bytes downloaded / total size
      const overallProgress = (
        (torrent.downloaded / torrent.length) *
        100
      ).toFixed(1);
  
      // Note: torrent.timeRemaining might be very inaccurate in this mode.
      const text = `Torrent: ${
        torrent.name
      }\nSpeed: ${speed} MB/s\nOverall Progress: ${overallProgress}%\n\nCurrent File: ${currentFileName} (${fileProgress}%)\nDownloaded: ${(
        torrent.downloaded /
        1024 /
        1024
      ).toFixed(1)} MB / ${(torrent.length / 1024 / 1024).toFixed(1)} MB`;
  
      if (prevText === text) return;
      prevText = text;
      a.edit({ text }).catch((error) => {
        // Handle potential rate limits or message-not-found errors
        if (error.message?.includes("message to edit not found")) {
          console.warn("Progress message was deleted or not found, cannot edit.");
          // Optionally resend the message if needed
        } else {
          console.log("Error editing progress message:", error.message || error);
        }
      });
    });
  
    torrent.once("error", async (err) => {
      console.error("Torrent error:", err);
      await a
        .edit({ text: `Torrent error: ${err.message}` })
        .catch((e) => console.log("Edit failed:", e));
  
      torrentSemaphore.release();
      torrent.destroy(); // Clean up
    });
  
    // --- Start the sequential processing once metadata is ready ---
    const startProcessing = () => {
      console.log("Torrent ready or metadata received.");
      console.log(
        "Files in torrent:",
        torrent.files.map((f) => ({ name: f.name, length: f.length }))
      );
      if (!fs.existsSync(path)) {
        console.log(`Creating download directory: ${path}`);
        fs.mkdirSync(path, { recursive: true });
      }
      // Don't wait for the torrent 'done' event, start our sequential process
      downloadAndProcessFilesSequentially(torrent.files).catch(async (err) => {
        console.error("Sequential processing failed:", err);
        await a
          .edit({ text: `Torrent processing failed: ${err.message}` })
          .catch((e) => console.log("Edit failed:", e));
  
        torrentSemaphore.release();
        torrent.destroy();
      });
    };
  
    if (torrent.ready) {
      startProcessing();
    } else {
      console.log("Waiting for torrent metadata...");
      torrent.once("metadata", startProcessing);
    }
  }
  async function cacheFile(name, size, id, client, chat) {
    try {
      await FileCacheDb.sync();
      const file = await FileCacheDb.findOne({
        where: {
          name,
          size,
        },
      });
      if (file) {
        return;
      }
      console.log(id);
  
      const ids = id
        .split(",")
        .filter((i) => i)
        .map(Number);
      console.log(ids);
      const messages = await client.getMessages(chat, { ids });
      let allids = "";
      for (const message of messages) {
        const msg = await client.sendMessage(cacheChannel, {
          message: message,
        });
        allids += msg.id + ",";
      }
  
      await FileCacheDb.create({
        name,
        size,
        msgId: allids,
      });
      console.log("File cached:", name, size, allids);
      
    } catch (e) {
      console.log("Error in cacheFile:", e);
    }
  }
  const FileCacheDb = config.DATABASE.define("filecachedb1", {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    msgId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  });
  
  module.exports = { handleTorrent,getWebClient,handleTorrentAdd };