const {Bot} = require('./src/bot.js');
global.bot = new Bot();
bot.start();