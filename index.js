var rp = require('request-promise');
var debug = require('debug')('slack-bot');

const ANNOUNCE_CHANNEL = process.env.SLACK_BOT_CHANNEL;
const MOPIDY_HOST_PORT = process.env.SLACK_BOT_MOPIDY_HOST_PORT || 'localhost:6680';

const { App, LogLevel } = require('@slack/bolt');


//////////////////////////////////////////////////////////////////////
// Main logic
var getTrackName = function(track) {
    var artist = 'Unknown Artist';
    if (track.artists && track.artists.length) {
        artist = track.artists[0].name;
    };
    return artist + ' - ' + track.name;
};

const controller = {};

controller.queue = function(say) {
    debug('Handling \'queue\' command');

    const tracksHandler = tracks => {
        debug('Empty queue');
        if (!tracks || !tracks.length) {
            say('Queue is empty');
            return;
        }
        debug('Tracks:', tracks);

        const indexHandler = index => {
            debug('Got index: ', index);
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
    debug('Handling \'skip\' command');
    say('Skipping current song');
    mopidy.playback.next();
};

controller.current = function(say) {
    debug('Handling \'current\' command');

    const trackHandler = track => {
        var msg = 'Nothing';
        if (track) {
            msg = getTrackName(track);
        }
        debug('Current track: ', msg);
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

controller.newTrack = function (event) {
    // Event: https://docs.mopidy.com/en/latest/api/models/#mopidy.models.TlTrack
    var track = event.tl_track.track;
    // TLID is the connection between Mopidy and the Iris metadata
    var tlid = event.tl_track.tlid;
    debug('Will look up Irisi metadata for track #', tlid);
    var req = {
        uri: 'http://' + MOPIDY_HOST_PORT + '/iris/http/get_queue_metadata',
        json: true
    };
    rp(req)
        .then(function(iris_data) {
            var msg = 'Playing: ' + getTrackName(track);

            if (iris_data.result && iris_data.result.queue_metadata) {
                var metadata = iris_data.result.queue_metadata;
                debug('Got iris data:', metadata);
                var track_info = metadata['tlid_' + tlid];
                if (track_info) {
                    var added_by = track_info['added_by'];
                    if (added_by) {
                        msg += ' [Added by: ' + added_by + ']';
                    }
                }
            }

            debug(msg);

            try {
                const result = app.client.chat.postMessage({
                    // TODO: ugly to use the token directly
                    token: process.env.SLACK_BOT_TOKEN,
                    channel: ANNOUNCE_CHANNEL,
                    text: msg,
                });
            }
            catch (error) {
                console.error('got error sending message: ', error);
            }


        })
        .catch(function(err) {
            console.error('Got error from Iris HTTP call:', err);
        });
};


//////////////////////////////////////////////////////////////////////
// Mopidy
const Mopidy = require('mopidy');
var mopidyConf = {
    webSocketUrl: 'ws://' + MOPIDY_HOST_PORT + '/mopidy/ws/'
};
const mopidy = new Mopidy(mopidyConf);
mopidy.on('state:online', function () {
    debug('Connected to Mopidy');
});

mopidy.on('event:trackPlaybackStarted', controller.newTrack);

// These are just for debugging, as they log every event from Mopidy
var mopidy_debug = require('debug')('mopidy');
mopidy.on('state', mopidy_debug);
mopidy.on('event', mopidy_debug);


//////////////////////////////////////////////////////////////////////
// Bolt
const bolt_config = {
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN
};
var bolt_debug = require('debug')('bolt');
if (bolt_debug.enabled) {
    bolt_config['logLevel'] = LogLevel.DEBUG;
}
const app = new App(bolt_config);

// Construct a say() command from an event and a context
function get_say(event, context) {
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
        controller.queue(get_say(event, context));
    } else if (event.text.match(/^<.+> skip/)) {
        controller.skip(get_say(event, context));
    } else if (event.text.match(/^<.+> current/)) {
    controller.current(get_say(event, context));
}
});


//////////////////////////////////////////////////////////////////////
// Main
(async () => {
    const server = await app.start(process.env.SLACK_BOT_PORT || 3000);
    console.log('Mopidy Slack Bot is running:', server.address());
})();
