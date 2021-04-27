const Discord = require('discord.js');
const Twitch = require('tmi.js');
const YouTube = require('youtube-live-chat')
const config = require('./config.json');
const axios = require('axios').default;
const WebSocket = require('ws'); // TODO: custom websocket support 
const MySQL = require('mysql');
const pool = MySQL.createPool(config.mysql);
const pkg = require('../package.json');

if(process.env.JEST_WORKER_ID === undefined) {
    // Discord auto-joins
    const discord = new Discord.Client();
    discord.login(config.discord.token);
    console.log('Joined Discord servers.');
    discord.on('message', function(msg) {
        if(msg.author.bot) return;
        var wrapper = new ChatLine('Discord', msg.content, msg.createdTimestamp, function(reply) {
            msg.reply(reply);
        });
        wrapper.handle();
    });

    let twitchChannels = [];
    let youtubeChannels = [];

    let twitch = null;

    function getUsers() {
        pool.query('SELECT twitchProfile, youtubeProfile FROM guilds', function(errors, results, fields) {
            for(var i = 0; i < results.length; i++) {
                if(results[i].twitchProfile) twitchProfile = JSON.parse(Buffer.from(results[i].twitchProfile, 'base64').toString('utf8'));
                if(results[i].youtubeProfile) youtubeProfile = JSON.parse(Buffer.from(results[i].youtubeProfile, 'base64').toString('utf8'));
                if(twitchProfile && !twitchChannels.includes('#' + twitchProfile.login)) {
                    twitchChannels.push('#' + twitchProfile.login);
                    if(twitch) {
                        console.log('Joined Twitch channel.', twitchChannels);
                        twitch.join('#' + twitchProfile.login);
                    }
                }
                if(youtubeProfile && !youtubeChannels.includes(youtubeProfile.id)) {
                    youtubeChannels.push(youtubeProfile.id);
                }
            }
            if(!twitch) {
                twitch = new Twitch.client({
                    reconnect: true,
                    identity: config.twitch.identity,
                    channels: twitchChannels
                });
                twitch.connect();
                twitch.on('message', function(channel, context, msg, self) {
                    if(context['user-id'] == config.twitch.userId) return; // self is broken
                    var wrapper = new ChatLine('Twitch', msg, context['tmi-sent-ts'], function(reply) {
                        twitch.say(channel, reply);
                    });
                    wrapper.handle();
                });
                console.log('Joined Twitch channels.', twitchChannels);
            }
            setTimeout(getUsers, 60000);
        });
    }
    getUsers();

    async function getYouTubeStreams() {
        for(var i = 0; i < youtubeChannels.length; i++) {
            (async () => {
                youtube = new YouTube(youtubeChannels[i], config.youtube.apiKey);
                console.log('Checking for YouTube stream.', youtubeChannels[i]);
                youtube.on('error', function(e) {
                    if(e == 'Can not find live.') console.log('No YouTube stream.', youtubeChannels[i]);
                    else if(typeof(e) == 'object' && 'error' in e && e.error.message == 'The live chat is no longer live.') youtube.stop();
                    else console.log(e);
                    youtube = null;
                });
                youtube.on('ready', function() {
                    console.log('Joined YouTube channel.', youtubeChannels[i]);
                    youtube.listen(1000);
                });
                youtube.on('message', function(data) {
                    if(data.snippet.type != 'textMessageEvent') return;
                    var time = new Date(data.snippet.publishedAt).getTime();
                    var wrapper = new ChatLine('YouTube', data.snippet.textMessageDetails.messageText, time, function(reply) {
                        axios.post('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet&access_token=' + config.youtube.token, {
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
            await new Promise(r => setTimeout(r, 1000));
        }
        setTimeout(getYouTubeStreams, 300000);
    }
    getYouTubeStreams();
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

module.exports.ChatLine = ChatLine;
