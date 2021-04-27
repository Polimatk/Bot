const EventEmitter = require('events');
const Discord = require('discord.js');
const Twitch = require('tmi.js');
const YouTube = require('youtube-live-chat')
const axios = require('axios').default;
const WebSocket = require('ws');
const MySQL = require('mysql');
const pkg = require('../package.json');

const CHECK = {USERS: 2, YOUTUBE_FIRST: 300, YOUTUBE_NEXT: 1}; // Time in seconds between checks

class Bot extends EventEmitter {
    constructor(jest=process.env.JEST_WORKER_ID !== undefined) {
        super();
        if(global.bot) return console.warn('Tried to construct bot twice!');
        this.started = false;
        this.jest = jest;
        this.discord = null;
        this.twitch = null;
        this.youtubes = {};
        this.twitchChannels = [];
        this.youtubeChannels = [];
        this.config = require(jest ? './example-config.json' : './config.json');
        this.pool = MySQL.createPool(this.config.mysql);
    }
    start() {
        if(this.started) return console.warn('Tried to start server twice!');
        this.started = true;
        if(!this.jest) {
            bot.discord = new Discord.Client();
            bot.discord.login(this.config.discord.token);
            console.log('Joined Discord servers.');
            bot.discord.on('message', function(msg) {
                if(msg.author.bot) return;
                var wrapper = new ChatLine('Discord', msg.content, msg.createdTimestamp, function(reply) {
                    msg.reply(reply);
                });
                wrapper.handle();
            });
            bot.checkUsers();
            bot.on('userdata', function() {
                bot.twitch = new Twitch.client({
                    reconnect: true,
                    identity: bot.config.twitch.identity,
                    channels: bot.twitchChannels
                });
                bot.twitch.connect();
                bot.twitch.on('message', function(channel, context, msg, self) {
                    if(context['user-id'] == bot.config.twitch.userId) return; // self is broken
                    var wrapper = new ChatLine('Twitch', msg, context['tmi-sent-ts'], function(reply) {
                        bot.twitch.say(channel, reply);
                    });
                    wrapper.handle();
                });
                console.log('Joined Twitch channels.', bot.twitchChannels);
                bot.checkYouTube();
            });
        }
    }
    checkUsers() {
        bot.pool.query('SELECT twitchProfile, youtubeProfile FROM guilds', function(errors, results, fields) {
            for(var i = 0; i < results.length; i++) {
                var twitchProfile = null;
                var youtubeProfile = null;
                if(results[i].twitchProfile) {
                    twitchProfile = JSON.parse(Buffer.from(results[i].twitchProfile, 'base64').toString('utf8'));
                    if(!bot.twitchChannels.includes('#' + twitchProfile.login)) {
                        bot.twitchChannels.push('#' + twitchProfile.login);
                        if(bot.twitch) {
                            console.log('Joined Twitch channel.', bot.twitchChannels);
                            bot.twitch.join('#' + twitchProfile.login);
                        }
                    }
                }
                if(results[i].youtubeProfile) {
                    youtubeProfile = JSON.parse(Buffer.from(results[i].youtubeProfile, 'base64').toString('utf8'));
                    if(!bot.youtubeChannels.includes(youtubeProfile.id)) bot.youtubeChannels.push(youtubeProfile.id);
                }
            }
            if(!bot.twitch) bot.emit('userdata');
            setTimeout(bot.checkUsers, CHECK.USERS * 1000);
        });
    }
    async checkYouTube() {
        for(var i = 0; i < bot.youtubeChannels.length; i++) {
            if(bot.youtubes.hasOwnProperty(bot.youtubeChannels[i])) return;
            (async() => {
                let youtube = new YouTube(bot.youtubeChannels[i], bot.config.youtube.apiKey);
                console.log('Checking for YouTube stream.', bot.youtubeChannels[i]);
                youtube.on('error', function(e) {
                    if(e == 'Can not find live.') console.log('No YouTube stream.', bot.youtubeChannels[i]);
                    else if(typeof(e) == 'object' && 'error' in e && e.error.message == 'The live chat is no longer live.') youtube.stop();
                    else console.log(e);
                    youtube = bot.youtubes[bot.youtubeChannels[i]] = null;
                });
                youtube.on('ready', function() {
                    console.log('Joined YouTube channel.', bot.youtubeChannels[i]);
                    bot.youtubes[bot.youtubeChannels[i]] = youtube;
                    youtube.listen(1000);
                });
                youtube.on('message', function(data) {
                    if(data.snippet.type != 'textMessageEvent') return;
                    var time = new Date(data.snippet.publishedAt).getTime();
                    var wrapper = new ChatLine('YouTube', data.snippet.textMessageDetails.messageText, time, function(reply) {
                        axios.post('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet&access_token=' + bot.config.youtube.token, {
                            snippet: {
                                type: 'textMessageEvent',
                                liveChatId: data.snippet.liveChatId,
                                textMessageDetails: {
                                    messageText: reply
                                }
                            }
                        });
                    });
                    wrapper.handle();
                });
            })();
            await new Promise(r => setTimeout(r, CHECK.YOUTUBE_NEXT * 1000));
        }
        setTimeout(bot.checkYouTube, CHECK.YOUTUBE_FIRST * 1000);
    }
}

class ChatLine {
    constructor(service, line, timestamp, reply) {
        line = line.trim();
        this.service = service;
        this.line = line;
        this.timestamp = timestamp;
        this.reply = reply;
        this.command = line.split(' ')[0].toLowerCase();
        this.args = line.split(' ').slice(1);
    }
    handle() {
        if(this.command == '-version') return this.reply('Polimatk/' + this.service + '@' + pkg.version);
    }
}

module.exports = {Bot, ChatLine};
