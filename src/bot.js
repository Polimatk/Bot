const EventEmitter = require('events');
const Discord = require('discord.js');
const Twitch = require('tmi.js');
const YouTube = require('youtube-live-chat')
const axios = require('axios').default;
const https = require('https');
const WebSocket = require('ws');
const MySQL = require('mysql');
const pkg = require('../package.json');

const CHECK = {USERS: 60, YOUTUBE_FIRST: 900, YOUTUBE_NEXT: 1}; // Time in seconds between checks

class Bot extends EventEmitter {
    constructor(jest=process.env.JEST_WORKER_ID !== undefined) {
        super();
        if(global.bot) return console.warn('Tried to construct bot twice!');
        this.started = false;
        this.jest = jest;
        this.discord = null;
        this.twitch = null;
        this.youtubeListeners = {};
        this.twitchChannels = {};
        this.youtubeChannels = {};
        this.guilds = {};
        this.config = require(jest ? './example-config.json' : './config.json');
        this.pool = MySQL.createPool(this.config.mysql);
        this.commands = require('./commands');
    }
    start() {
        if(this.started) return console.warn('Tried to start server twice!');
        this.started = true;
        if(!this.jest) {
            bot.discord = new Discord.Client();
            bot.discord.login(this.config.discord.token);
            bot.discord.on('ready', function() {
                console.log('Joined Discord servers.');
                bot.discord.user.setPresence({
                    activity: {
                        name: 'rhetorical games',
                        type: 'PLAYING',
                        url: 'https://polima.tk'
                    },
                    status: 'available'
                });
                bot.checkUsers();
            });
            bot.discord.on('message', function(msg) {
                if(msg.author.bot) return;
                console.log('Discord < ' + msg.content);
                var role = 'all';
                if(!msg.member) return;
                if(msg.member.roles.cache.has('subscriber') || msg.member.roles.cache.has('subs')
                    || msg.member.roles.cache.has('subscribers') || msg.member.roles.cache.has('member')
                    || msg.member.roles.cache.has('members')) role = 'subs';
                if(msg.member.hasPermission('MANAGE_GUILD', {checkAdmin: true, checkOwner: true})) role = 'mods';
                var wrapper = new ChatLine('Discord', msg.content, msg.createdTimestamp, function(reply) {
                    console.log('Discord > ' + reply)
                    msg.reply(reply);
                }, msg.guild.id, role, msg.author.username);
                wrapper.handle();
            });
            bot.on('userdata', function() {
                bot.twitch = new Twitch.client({
                    reconnect: true,
                    identity: bot.config.twitch.identity,
                    channels: Object.keys(bot.twitchChannels)
                });
                bot.twitch.connect();
                bot.twitch.on('message', function(channel, context, msg, self) {
                    if(context['message-type'] == 'action') return;
                    if(self) return;
                    console.log('Twitch < ' + msg);
                    var role = 'all';
                    if(context.subscriber) role = 'subs';
                    if(context.mod || context.username == channel.substr(1)) role = 'mods';
                    var wrapper = new ChatLine('Twitch', msg, context['tmi-sent-ts'], function(reply) {
                        console.log('Twitch > ' + reply);
                        bot.twitch.say(channel, reply);
                    }, bot.twitchChannels[channel], role, context['display-name']);
                    wrapper.handle();
                });
                console.log('Joined Twitch channels.', Object.keys(bot.twitchChannels));
                bot.checkYouTube();
            });
        }
    }
    checkUsers() {
        bot.pool.query('SELECT * FROM guilds', function(errors, results, fields) {
            for(var i = 0; i < results.length; i++) {
                // Decode and store guild
                results[i].discordProfile = JSON.parse(Buffer.from(results[i].discordProfile, 'base64').toString('utf8'));
                if(results[i].twitchProfile) results[i].twitchProfile = JSON.parse(Buffer.from(results[i].twitchProfile, 'base64').toString('utf8'));
                if(results[i].youtubeProfile) results[i].youtubeProfile = JSON.parse(Buffer.from(results[i].youtubeProfile, 'base64').toString('utf8'));
                bot.guilds[results[i].discordId] = results[i];
                // Queue and join connected streams
                if(results[i].twitchProfile) {
                    if(!bot.twitchChannels.hasOwnProperty('#' + results[i].twitchProfile.login)) {
                        bot.twitchChannels['#' + results[i].twitchProfile.login] = results[i].discordId;
                        if(bot.twitch) {
                            console.log('Joined Twitch channel.', bot.twitchChannels);
                            bot.twitch.join('#' + results[i].twitchProfile.login);
                        }
                    }
                }
                if(results[i].youtubeProfile) {
                    if(!bot.youtubeChannels.hasOwnProperty(results[i].youtubeProfile.id)) bot.youtubeChannels[results[i].youtubeProfile.id] = results[i].discordId;
                }
            }
            if(!bot.twitch) bot.emit('userdata');
            setTimeout(bot.checkUsers, CHECK.USERS * 1000);
        });
    }
    async checkYouTube() {
        for(const [youtubeId, discordId] of Object.entries(bot.youtubeChannels)) {
            if(bot.youtubeListeners.hasOwnProperty(youtubeId)) return;
            (async() => {
                let youtube = new YouTube(youtubeId, bot.config.youtube.apiKey);
                console.log('Checking for YouTube stream.', youtubeId);
                youtube.on('error', function(e) {
                    if(e == 'Can not find live.') console.log('No YouTube stream.', youtubeId);
                    else if(typeof(e) == 'object' && 'error' in e && e.error.message == 'The live chat is no longer live.') youtube.stop();
                    else console.log(e);
                    youtube = bot.youtubeListeners[youtubeId] = null;
                });
                youtube.on('ready', function() {
                    console.log('Joined YouTube channel.', youtubeId);
                    bot.youtubeListeners[youtubeId] = youtube;
                    youtube.listen(CHECK.YOUTUBE_NEXT);
                });
                youtube.on('message', function(data) {
                    if(data.snippet.type != 'textMessageEvent') return;
                    if(data.snippet.authorChannelId == bot.config.youtube.channelId) return;
                    console.log('YouTube < ' + data.snippet.textMessageDetails.messageText);
                    var role = 'all';
                    if(data.snippet.authorDetails.isChatSponsor) role = 'subs';
                    if(data.snippet.authorDetails.isChatOwner || data.snippet.authorDetails.isChatModerator) role = 'mods';
                    var time = new Date(data.snippet.publishedAt).getTime();
                    var wrapper = new ChatLine('YouTube', data.snippet.textMessageDetails.messageText, time, function(reply) {
                        console.log('YouTube > ' + reply);
                        axios.post('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet&access_token=' + bot.config.youtube.token, {
                            snippet: {
                                type: 'textMessageEvent',
                                liveChatId: data.snippet.liveChatId,
                                textMessageDetails: {
                                    messageText: reply
                                }
                            }
                        }, discordId, role, data.snippet.authorDetails.displayName);
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
    constructor(service, line, timestamp, reply, guild, role, user) {
        line = line.trim();
        this.service = service;
        this.line = line;
        this.timestamp = timestamp;
        this.reply = reply;
        this.guild = guild;
        this.role = role;
        this.user = user;
        this.command = line.split(' ')[0].toLowerCase();
        this.args = line.split(' ').slice(1);
    }
    handle() {
        if(bot.commands.hasOwnProperty(this.command)) {
            bot.commands[this.command].handle(this);
        }
        else {
            const line = this;
            bot.pool.query('SELECT * FROM commands WHERE guild = ? AND name = ?', [this.guild, this.command], function(error, results, fields) {
                if(results.length) {
                    let response = results[0].response;
                    if(results[0].permissions == 'none') return;
                    if(results[0].permissions == 'subs' && line.role == 'all') return;
                    if(results[0].permissions == 'mods' && line.role != 'mods') return;
                    response = response.replace('{platform}', line.service);
                    response = response.replace('{guild id}', line.guild);
                    response = response.replace('{guild name}', bot.guilds[line.guild].discordProfile.name);
                    response = response.replace('{guild slug}', bot.guilds[line.guild].slug);
                    response = response.replace('{user name}', line.user);
                    response = response.replace('{user role}', line.role);
                    response = response.replace('{args}', line.args.join(' '));
                    response = line.runArgs(response);
                    line.runAPI(response).then(function(final) {
                        line.reply(final);
                    }).catch(function(e) {
                        line.reply('API ' + e);
                    });
                }
            });
        }
    }
    runAPI(response) {
        return new Promise((resolve, reject) => {
            const apis = response.match(/{api (https?:\/\/[^ ]+)( ?.+)?}/i);
            if(!apis) return resolve(response);
            axios.get(apis[1], {httpsAgent: new https.Agent({rejectUnauthorized: false})}).then(function(api) {
                response = response.replace(/{api (https?:\/\/[^ ]+)( ?.+)?}/mi,
                    apis[2] && apis[2] != ' ' ? getProperty(api.data, apis[2].substr(1)) :
                    (typeof api.data == 'string' ? api.data : JSON.stringify(api.data)));
                if(apis.length < 4) resolve(response);
                else runAPI(response).then(resolve);
            }).catch(function(e) {
                reject(e);
            });
        });
    }
    runArgs(response) {
        for(var i = 1; i <= 10; i++) {
            response = response.replace('{args ' + i + '}', this.args[i - 1]);
        }
        return response;
    }
}

function getProperty(object, key) {
    let keys = key.split('.');
    if(keys.length > 1 && object.hasOwnProperty(keys[0])) return getProperty(object[keys[0]], keys.slice(1).join('.'));
    else if(keys.length == 1) return typeof object[keys[0]] == 'string' ? object[keys[0]] : JSON.stringify(object[keys[0]]);
    else return null;
}

module.exports = {Bot, ChatLine};
