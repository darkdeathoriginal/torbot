const { addCommand } = require("..");

addCommand({
  pattern: "start",
  description: "Start command",
  sudo: true,
  callback: async (message, match, obj) => {
    let msg = "Bot is started!\n\nBot commands:\n";
    for (let i of obj.modules) {
      if (i.pattern && i.description && !i.dontAdd) {
        msg += `/${i.pattern} - ${i.description}\n`;
      }
    }
    await message.send(msg);
  },
});
