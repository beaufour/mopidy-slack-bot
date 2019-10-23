var rp = require("request-promise");
var debug = require("debug")("slack-bot");

const PLAYLIST_CHANNEL = process.env.SLACK_BOT_CHANNEL_PLAYLIST;
const ANNOUNCE_CHANNEL = process.env.SLACK_BOT_CHANNEL_ANNOUNCE;
const MOPIDY_HOST_PORT = process.env.SLACK_BOT_MOPIDY_HOST_PORT || "localhost:6680";
const ICECAST_URL = process.env.SLACK_BOT_ICECAST_URL || "http://localhost:8000";

const { App, LogLevel } = require("@slack/bolt");


//////////////////////////////////////////////////////////////////////
// Utility functions
function getTrackInfo(trackData, irisData) {
    var track = trackData.track;
    var artist = "Unknown Artist";
    if (track.artists && track.artists.length) {
        artist = track.artists[0].name;
    };
    var msg = artist + " - " + track.name;
    if (irisData) {
        var trackInfo = irisData["tlid_" + trackData.tlid];
        if (trackInfo) {
            var addedBy = trackInfo["added_by"];
            if (addedBy) {
                msg += " [Added by: " + addedBy + "]";
            }
        }
    }

    return msg;
};

async function getIrisData() {
    var data = await rp({
        uri: "http://" + MOPIDY_HOST_PORT + "/iris/http/get_queue_metadata",
        json: true
    });
    if (!data.result || !data.result.queue_metadata) {
        return;
    }

    var metadata = data.result.queue_metadata;
    debug("Got iris data:", metadata);
    return metadata;
};

async function getQueueHead() {
    var tracks = await mopidy.tracklist.getTlTracks();
    if (!tracks || !tracks.length) {
        return [];
    }
    var index = await mopidy.tracklist.index();
    return tracks.slice(index + 1, index + 6);
};


//////////////////////////////////////////////////////////////////////
// Controller which holds the main app logic
const controller = {};

controller.listeners = async function(say) {
    debug("Handling 'listeners' command");
    try {
        var status = await rp({
            uri: ICECAST_URL + "/status-json.xsl",
            json: true
        });
        debug("Icecast data:", status);
        if (status.icestats && status.icestats.source) {
            var listeners = status.icestats.source.listeners;
            say("There are currently " + listeners + " listener(s)");
        } else {
            console.warn("Could not find listener information in IceCast output");
            say("Could not get listeners :(");
        }
    } catch (error) {
        console.warn("Could not get listeners information: ", error);
        say("Could not get listeners :(");
    }
};

controller.queue = async function(say) {
    debug("Handling 'queue' command");

    try {
        var tracks = await getQueueHead();
        if (!tracks.length) {
            debug("Empty queue");
            say("Queue is empty");
            return;
        }
        debug("Tracks:", tracks);

        var irisData = await getIrisData();
        var msg = "";
        for (var i = 0; i < tracks.length; ++i) {
            msg = msg + (i + 1) + ". " + getTrackInfo(tracks[i], irisData) + "\n";
        }
        say("Here is the queue:\n" + msg);
    } catch (error) {
        console.warn("Could not get queue: ", error);
        say("Could not get queue :(");
    };
};

controller.skip = function(say) {
    debug("Handling 'skip' command");
    say("Skipping current song");
    mopidy.playback.next();
};

controller.current = async function(say) {
    debug("Handling 'current' command");

    try {
        var track = await mopidy.playback.getCurrentTlTrack();
        var irisData = await getIrisData();
        var msg = "Nothing";
        if (track) {
            msg = getTrackInfo(track, irisData);
        }
        debug("Current track: ", msg);
        msg = "Currently playing: " + msg;
        say(msg);
    } catch(error) {
        console.warn("Could not get current track: ", error);
        say("Could not get current track :(");
    };
};

controller.newTrack = async function (event) {
    function say(text, channelId) {
        return app.client.chat.postMessage({
            // TODO: ugly to use the token directly
            token: process.env.SLACK_BOT_TOKEN,
            channel: channelId,
            text,
        });
    }

    var track = event.tl_track;
    try {
        var irisData = await getIrisData();
        var msg = "Playing: " + getTrackInfo(track, irisData);
        debug(msg);

        try {
            say(msg, PLAYLIST_CHANNEL);
        }
        catch (error) {
            console.error("got error sending message: ", error);
        }
    } catch (error) {
        console.error("Got error from Iris HTTP call:", error);
    }

    try {
        var tracks = await getQueueHead();
        if (!tracks.length) {
            debug("No more tracks in queue after the current song");
            say("No more tracks in queue after the current song", ANNOUNCE_CHANNEL);
        }
    } catch (error) {
        console.error("Got error when trying to check queue:", error);
    }
};


//////////////////////////////////////////////////////////////////////
// Mopidy
const Mopidy = require("mopidy");
var mopidyConf = {
    webSocketUrl: "ws://" + MOPIDY_HOST_PORT + "/mopidy/ws/"
};
const mopidy = new Mopidy(mopidyConf);
mopidy.on("state:online", function () {
    debug("Connected to Mopidy");
});

mopidy.on("event:trackPlaybackStarted", controller.newTrack);

// These are just for debugging, as they log every event from Mopidy
var mopidy_debug = require("debug")("mopidy");
mopidy.on("state", mopidy_debug);
mopidy.on("event", mopidy_debug);


//////////////////////////////////////////////////////////////////////
// Bolt
const boltConfig = {
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN
};
var boltDebug = require("debug")("bolt");
if (boltDebug.enabled) {
    boltConfig["logLevel"] = LogLevel.DEBUG;
}
const app = new App(boltConfig);

// Construct a say() command from an event and a context
function getSay(event, context) {
    return async function(text) {
        try {
            const result = await app.client.chat.postMessage({
                token: context.botToken,
                channel: event.channel,
                text,
            });
        }
        catch (error) {
            console.error("got error sending message: ", error);
        }
    };
}

app.message("queue", async ({ message, say }) => {
    controller.queue(say);
});

app.message("skip", ({ message, say }) => {
    controller.skip(say);
});

app.message("current", ({ message, say }) => {
    controller.current(say);
});

app.message("listeners", ({ message, say }) => {
    controller.listeners(say);
});

app.event("app_mention", async ({ event, context }) => {
    if (event.text.match(/^<.+> queue/)) {
        controller.queue(getSay(event, context));
    } else if (event.text.match(/^<.+> skip/)) {
        controller.skip(getSay(event, context));
    } else if (event.text.match(/^<.+> current/)) {
        controller.current(getSay(event, context));
    } else if (event.text.match(/^<.+> listeners/)) {
        controller.listeners(getSay(event, context));
    }
});


//////////////////////////////////////////////////////////////////////
// Main
(async () => {
    const server = await app.start(process.env.SLACK_BOT_PORT || 3000);
    console.log("Mopidy Slack Bot is running:", server.address());
})();
