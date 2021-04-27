const ChatLine = require('../src/bot.js').ChatLine;
const pkg = require('../package.json');

test('Try -version command', done => {
    new ChatLine('Test', '-version', Date.now(), function(reply) {
        expect(reply).toBe('Polimatk/Test@' + pkg.version);
        done();
    }).handle();
});