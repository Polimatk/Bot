const fs = require('fs');

const commands = {};
fs.readdirSync(__dirname).forEach((file) => {
    if(file == 'index.js') return;
    var cmd = require('./' + file);
    commands[cmd.name] = cmd;
});
console.log('Commands loaded.', commands);

module.exports = commands;