let WebRTC = require('react-native-webrtc');
let {
    RTCPeerConnection,
    RTCSessionDescription,
} = WebRTC;

let server = 'http://188.166.53.100:8088/janus';
let token = 'testing';
let plugin = 'janus.plugin.streaming';
let streamId = 99;

let opaqueId = null;
let sessionId = null;
let handleId = null;

let connected = false;

let longPollRetries = 0;

const configuration = { iceServers: [{ url: 'stun:stun.l.google.com:19302' }] };
let pc = null;

const DEBUG = true;

export default class Janus {

    constructor(container) {
        opaqueId = 'feedovision-' + Janus.randomString(12);
        pc = new RTCPeerConnection(configuration);
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                Janus.sendCandidate(event.candidate);
            }
        };
        pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
                Janus.sendCandidateComplete();
            }
        };
        pc.onaddstream = (event) => {
            Janus.log('Setting video url: ' + event.stream.toURL());
            container.setState({ videoUrl: event.stream.toURL() });
        };
    }

    createSession() {
        Janus.log('Creating session');
        let request = {
            janus: "create",
            transaction: Janus.randomString(12),
            token: token
        };
        Janus.apiRequest('POST', server, request)
            .then((json) => {
                if (json['janus'] === 'success') {
                    sessionId = json['data']['id'];
                    Janus.log('Created session with id ' + sessionId);
                    connected = true;
                    this.createHandle();
                } else {
                    Janus.log('Could not create session');
                }
            });
    }

    createHandle() {
        Janus.log('Creating handle');
        if (sessionId == null) {
            Janus.log('Could not create handle, no session id');
            return;
        }
        let url = server + '/' + sessionId;
        let request = {
            janus: 'attach',
            plugin: plugin,
            opaque_id: opaqueId,
            transaction: Janus.randomString(12),
            token: token,
            'force-bundle': true,
            'force-rtcp-mux': true
        };
        Janus.apiRequest('POST', url, request)
            .then((json) => {
                if (json['janus'] === 'success') {
                    handleId = json['data']['id'];
                    Janus.log('Created handle with id ' + handleId);
                    Janus.requestStream();
                } else {
                    Janus.log('Could not create handle');
                }
            })
    }

    static requestStream() {
        Janus.log('Requesting stream');
        if (sessionId == null || handleId == null) {
            Janus.log('Could not create request stream, no session/handle id');
            return;
        }
        let url = server + '/' + sessionId + '/' + handleId;
        let request = {
            janus: 'message',
            transaction: Janus.randomString(12),
            token: token,
            body: {
                request: 'watch',
                id: streamId
            }
        };
        Janus.apiRequest('POST', url, request);
        Janus.messageHandler();
    }

    static messageHandler() {
        if (sessionId == null || handleId == null || !connected) return;
        let url = server + '/' + sessionId + '/' + new Date().getTime() + '&token=' + token;
        Janus.apiRequest('GET', url, null, 60)
            .then((json) => {
                Janus.handleMessage(json)
            })
            .catch(() => {
                if (longPollRetries++ > 3) {
                    connected = false;
                    longPollRetries = 0;
                    Janus.log('Lost connection to gateway');
                    return;
                }
                Janus.messageHandler()
            });
    }

    static handleMessage(json) {
        setTimeout(Janus.messageHandler, 200);
        //Janus.log('MESSAGE: ' + JSON.stringify(json));
        let message = json['janus'];
        switch (message) {
            case 'event':
                Janus.handleEvent(json);
                break;
        }
    }

    static handleEvent(json) {
        if (json['plugindata'] != null) {
            Janus.handlePluginEvent(json);
        }
    }

    static handlePluginEvent(json) {
        if (json['jsep'] != null && json['jsep']['type'] === 'offer') {
            Janus.handleOffer(json['jsep']);
        } else if (json['plugindata']['data']['streaming'] === 'event') {
            Janus.log('Stream ' + json['plugindata']['data']['result']['status']);
        }
    }

    static handleOffer(jsep) {
        Janus.log('Got an offer!');
        Janus.debug(JSON.stringify(jsep));
        if (jsep['sdp'] == null) {
            Janus.log('Could not handle offer, no session description');
            return;
        }
        pc.setRemoteDescription(new RTCSessionDescription(jsep), () => {
            Janus.log('Offer accepted, creating answer');
            pc.createAnswer()
                .then((answer) => {
                    pc.setLocalDescription(answer)
                        .then(() => {
                            this.createAnswer(answer);
                            Janus.log('Answer sent');
                        });
                })
        }, Janus.log);
    }

    static createAnswer(jsep) {
        let url = server + '/' + sessionId + '/' + handleId;
        let request = {
            janus: 'message',
            transaction: Janus.randomString(12),
            token: token,
            body: {
                request: 'start'
            },
            jsep: jsep
        };
        Janus.apiRequest('POST', url, request);
    }

    static sendCandidate(candidate) {
        Janus.log('Sending candidate');
        let url = server + '/' + sessionId + '/' + handleId;
        let request = {
            janus: 'trickle',
            transaction: Janus.randomString(12),
            token: token,
            candidate: candidate
        };
        Janus.apiRequest('POST', url, request);
    }

    static sendCandidateComplete() {
        Janus.log('Sending candidate complete');
        let url = server + '/' + sessionId + '/' + handleId;
        let request = {
            janus: 'trickle',
            transaction: Janus.randomString(12),
            token: token,
            candidate: {
                completed: true
            }
        };
        Janus.apiRequest('POST', url, request);
    }

    static apiRequest(type, url, body, timeout) {
        return new Promise((resolve, reject) => {
            if (timeout !== undefined && timeout !== null) {
                setTimeout(reject.bind(null, new Error('API request timed out!')), timeout * 1000);
            }
            if (type === 'POST') {
                return fetch(url, {
                    method: type,
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                })
                    .then((res) => res.json())
                    .then((json) => {
                        resolve(json);
                    });
            } else {
                return fetch(url, {
                    method: type,
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }
                })
                    .then((res) => res.json())
                    .then((json) => {
                        resolve(json);
                    });
            }
        });
    }

    static randomString(len) {
        let charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let randomString = '';
        for (let i = 0; i < len; i++) {
            let randomPoz = Math.floor(Math.random() * charSet.length);
            randomString += charSet.substring(randomPoz,randomPoz+1);
        }
        return randomString;
    };

    static log(message) {
        console.log('JANUS: ' + message);
    }

    static debug(message) {
        if (DEBUG === true) {
            console.log('DEBUG: ' + message);
        }
    }

}