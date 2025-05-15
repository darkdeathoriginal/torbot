// const axios = require("axios");
// const { XMLParser } = require("fast-xml-parser");
// const { addCommand } = require("..");
// const config = require("../config");
// const { DataTypes } = require("sequelize");
// const { handleTorrentAdd } = require("../lib/torrent");

// const timeout = 1000 * 60 * 10;
// const chat = config.sudo
// const rssFeeds = [
//   {
//     url: "https://nyaa.si/?page=rss&u=varyg1001",
//     chat: "-1002189835997",
//   },
//   {
//     url: "https://nyaa.si/?page=rss&u=subsplease",
//     chat: "-1002189835997",
//   },
//   {
//     url: "https://nyaa.si/?page=rss&u=Erai-raws",
//     chat: "-1002189835997",
//   },
//   {
//     url:"https://nyaa.si/?page=rss&q=%5BToonsHub%5D+&c=1_2&f=0",
//     chat :"-1002189835997"
//   }
// ];

// addCommand({
//   on: "start",
//   callback: async (client) => {
//     await notificationDb.sync();
//     client.sendMessage(chat, { message: "Started subsplease rss feed" });
//     while (true) {
//       try {
//         for (const rss of rssFeeds) {
//           const data = await getData(rss.url);
//           if (data) {
//             const dbData = await notificationDb.findOne({
//               where: { url: rss.url },
//             });
//             const newArray = getArray(dbData, data);
//             if (newArray.length > 0) {
//               for (let i = 0; i < newArray.length; i++) {
//                 const magnet =
//                   "magnet:?xt=urn:btih:" + newArray[i]["nyaa:infoHash"];
//                 handleTorrentAdd(magnet, {
//                   jid: rss.chat,
//                   client,
//                 });
//               }
//               await notificationDb.destroy({ where: { url: rss.url } });
//               await notificationDb.create({
//                 name: newArray[0].title,
//                 url: rss.url,
//               });
//             }
//           }
//         }
//       } catch (error) {
//         console.log(error);
//       }
//       await sleep(timeout);
//     }
//   },
// });

// function getArray(db, data) {
//   if (!db?.name) return [data[0]];
//   const name = db.name;
//   let index;
//   for (let i = 0; i < data.length; i++) {
//     if (data[i].title == name) {
//       index = i;
//       break;
//     }
//   }
//   if (index == undefined) return [data[0]];
//   const newArray = data.slice(0, index);
//   return newArray.reverse();
// }

// function getData(rssUrl) {
//   return new Promise(async (resolve, reject) => {
//     try {
//       const response = await axios.get(rssUrl, {
//         headers: {
//           "User-Agent":
//             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
//         },
//       });
//       const data = response.data;
//       const parser = new XMLParser();
//       let rss = parser.parse(data);
//       const final = rss?.rss?.channel?.item;
//       resolve(final);
//     } catch (error) {
//       reject(error);
//     }
//   });
// }

// function sleep(ms) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// const notificationDb = config.DATABASE.define("notification2", {
//   name: {
//     type: DataTypes.STRING,
//     allowNull: false,
//   },
//   url: {
//     type: DataTypes.STRING,
//     allowNull: false,
//   },
// });
