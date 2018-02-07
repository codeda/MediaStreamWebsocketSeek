const HTTPS_PORT = 443;
const express = require('express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const WebSocketServer = require('websocket').server;
const cp = require('child_process');
const terminate = require('terminate');

const PREVIEW_VIDEO_FORMAT = "mp4";
const PREVIEW_VIDEO_ACODEC = "aac";
const PREVIEW_VIDEO_VCODEC = "libx264";
const PREVIEW_VIDEO_SIZE = "640x360";
const PREVIEW_AUDIO_BITRATE = "64k";
const PREVIEW_VIDEO_BITRATE = "960k";
const AUDIO_FREQUENCY = 48000;
const PIXEL_FORMAT = 'yuv420p';
const FPS = 60;
const SCRIPTS_PATH='linux';

var options = {
    key: fs.readFileSync('keys/privkey.pem'),
    cert: fs.readFileSync('keys/fullchain.pem')
};

var app = express();

app.use('/', express.static(__dirname));

var httpsServer = https.createServer(options, app);
httpsServer.listen(HTTPS_PORT, function() {
    console.log((new Date()) + ' Server is listening on port '+HTTPS_PORT);
});

var webSocketServer =new WebSocketServer({httpServer: httpsServer,  autoAcceptConnections: false});

webSocketServer.on('request', function(request) {
    var ws = request.accept('echo-protocol', request.origin);
    ws.previews=[];
    ws.json = function (o) {
        ws.send(JSON.stringify(o));
    };
    ws.on('message', function (ms) {
        if (ms.type === 'utf8') {
            console.log('Received Message: ' + ms.utf8Data);
            var message = ms.utf8Data;

            var json = JSON.parse(message);
            switch (json.action) {
                case 'seekVideo':
                    ws.lastSeek=json.seek;
                    killAllPreviews();
                    ws.json({action:'seekReady',seek:json.seek});
                    launchPreview(path.resolve(__dirname,'badvideo.mp4'),json.seek);
                    break;
            }
        }
    });
    function killAllPreviews(){
        while(ws.previews.length){
            var sh=ws.previews.shift();
            if(sh)
            {
                terminate(sh.pid, function(err, done){
                    if(err) {
                        console.log("Oopsy: " + err);
                    }
                    else {
                        sh=null;

                    }
                });
            }
        }
    }

    function launchPreview(videoPath,ss,callback)
    {
        runNativeScriptPreview([ss,videoPath,
            PREVIEW_VIDEO_SIZE,
            PREVIEW_AUDIO_BITRATE,
            AUDIO_FREQUENCY,PREVIEW_VIDEO_ACODEC,
            PREVIEW_VIDEO_VCODEC,PREVIEW_VIDEO_BITRATE,FPS,
            PIXEL_FORMAT,PREVIEW_VIDEO_FORMAT],function(_cp){
            if (callback !== undefined)
                callback(null);
        });
    }

    function runNativeScriptPreview(options,callback) {
        var type='preview';
        var sh=cp.spawn(path.resolve(__dirname,SCRIPTS_PATH,type+'.sh'),options,{
            detached: false
        });
        ws.previews.push(sh);
        var firstRegexp=/VideoHandler/g;
        var firstRegexp2=/encoder/g;
        var secondRegexp=/time=(.*?) bitrate/g;

        var lastTo=new Date();
        sh.stdout.on('data', function(data) {
            if(ws.lastSeek==options[0])
            {
                ws.send(data, {binary: true, mask: false});

            }
        });
        sh.stderr.on('data', function(data) {
            if(typeof data === 'string')
            {
                console.log("stderr",data);
            }
            if(callback)
            {
                console.log("from launch to answer",(new Date()-lastTo));
                callback=null;
                lastTo=new Date();
            }
            if(firstRegexp.test(data) && firstRegexp2.test(data))
            {
                console.log("from answer to waiting",(new Date()-lastTo));
                lastTo=new Date();
            }
            if(lastTo && secondRegexp.test(data))
            {
                console.log("from waiting to streaming",new Date()-lastTo);
                lastTo=null;
            }
        });
        //callback(sh);

    };
});