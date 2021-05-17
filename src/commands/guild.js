module.exports = {
    name: '-guild',
    args: 0,
    handle: function(line) {
        var slug = bot.guilds[line.guild].slug;
        if(!slug) return line.reply('The guild isn\'t set up. Use -dashboard to change bot settings.');
        line.reply('https://polima.tk/@' + slug);
    }
}