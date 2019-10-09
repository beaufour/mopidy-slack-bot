const { App, LogLevel } = require('@slack/bolt');

var getTrackName = function(track) {
    var artist = 'Unknown Artist';
    if (track.artists && track.artists.length) {
        artist = track.artists[0].name;
    };
    return artist + ' - ' + track.name;
};

const controller = {};

controller.queue = function(say) {
    console.log('>> queue');

    const tracksHandler = tracks => {
        console.log('Empty queue');
        if (!tracks || !tracks.length) {
            say('Queue is empty');
            return;
        }
        console.log('Tracks:', tracks);

        const indexHandler = index => {
            console.log('Got index: ', index);
            tracks = tracks.slice(index + 1, index + 6);
            var msg = '';
            for (var i = 0; i < tracks.length; ++i) {
                msg = msg + (i + 1) + '. ' + getTrackName(tracks[i]) + '\n';
            }
            say('Here is the queue:\n' + msg);
        };

        mopidy.tracklist.index().then(indexHandler, failureHandler);
    };
    const failureHandler = () => {
        console.warn('Could not get queue: ');
        say('Could not get queue :(');
    };
    mopidy.tracklist.getTracks().then(tracksHandler, failureHandler);
};

controller.skip = function(say) {
    console.log('>> skip');
    say('Skipping current song');
    mopidy.playback.next();
};

controller.current = function(say) {
    console.log('>> current');

    const trackHandler = track => {
        var msg = 'Nothing';
        if (track) {
            msg = getTrackName(track);
        }
        console.log('Current track: ', msg);
        msg = 'Currently playing: ' + msg;
        say(msg);
        return;
    };

    const failureHandler = () => {
        console.warn('Could not get current track: ');
        say('Could not get current track :(');
    };
    mopidy.playback.getCurrentTrack().then(trackHandler, failureHandler);
};

const Mopidy = require('mopidy');

const mopidy = new Mopidy({
    // TODO should be a configuration variable
    webSocketUrl: 'ws://mopidy:6680/mopidy/ws/',
});

// These are just for debugging, as they log every event from Mopidy
mopidy.on('state', console.log);
mopidy.on('event', console.log);

mopidy.on('state:online', function () {
    console.log('Connected to Mopidy');
});

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
    logLevel: LogLevel.DEBUG,
});

function post_message(event, context) {
    return async function(text) {
        try {
            const result = await app.client.chat.postMessage({
                token: context.botToken,
                channel: event.channel,
                text: text,
            });
        }
        catch (error) {
            console.error('got error sending message: ', error);
        }
    };
}

app.message('queue', async ({ message, say }) => {
    controller.queue(say);
});

app.message('skip', ({ message, say }) => {
    controller.skip(say);
});

app.message('current', ({ message, say }) => {
    controller.current(say);
});

app.event('app_mention', async ({ event, context }) => {
    if (event.text.match(/^<.+> queue/)) {
        controller.queue(post_message(event, context));
    } else if (event.text.match(/^<.+> skip/)) {
        controller.skip(post_message(event, context));
    } else if (event.text.match(/^<.+> current/)) {
    controller.current(post_message(event, context));
}
});

(async () => {
    var port = process.env.PORT || 3000;
    await app.start(port);
    console.log('Mopidy Bot is running on port', port);
})();
