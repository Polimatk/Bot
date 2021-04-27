const {Bot, ChatLine} = require('../src/bot.js');
const pkg = require('../package.json');
const bot = new Bot();

test('Try -version command', done => {
    bot.start();
    new ChatLine('Test', '-version', Date.now(), function(reply) {
        expect(reply).toBe('Polimatk/Test@' + pkg.version);
        done();
    }).handle();
});