const pkg = require('../../package.json');

module.exports = {
    name: '-version',
    args: 0,
    handle: function(line) {
        line.reply('Using Polimatk/' + line.service + '@' + pkg.version + '.');
    }
}