import "dotenv/config";

import express from "express";

import {expressjwt} from "express-jwt";

import * as logger from "./logger.js";

import {config} from "./config.js";

import http from "http";

const app = express();

const server = http.createServer(app);

import cors from "cors";

app.use(cors()); // TODO, allow restricting domains. 

import LocalManager, { LocalApplication } from "./manager/local.js";

import crypto from "crypto";

import jwt from "jsonwebtoken";

import {Server} from "socket.io";

import {SESSION_STATE} from "./protocol.js"

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

let m = new LocalManager();

(async () => {
    await m.start();
    logger.info("LocalManager started");
})();

let auth = expressjwt({
    secret: config.secret,
    algorithms: ["HS256"],
}).unless({
    path: "/api/v1/try_login" // todo don't hardcode version maybe?
});

import morgan from "morgan";

if(process.env.NODE_ENV == "production"){
    app.use(morgan("combined"));
}else{
    app.use(morgan("dev"));
}

app.get("/api/v1/check", (req,res) => res.json({
    ok: true
}));

// for simulating lag during dev
function sleep(ms){
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

// Router
const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({extended: false}));

// access token might be an alternate login method that is used on every request
// ok I switched to passwords for now, stuff is still referencing access tokens though
router.all("/try_login", (req, res) => {
    let accessToken = req.method != "GET" && req.body && (req.body.accessToken || req.body.password);
    if(req.query.at && !accessToken){
        // quick test thing that allows token to be specified in url. 
        accessToken = req.query.at;
    }
    if(!accessToken){
        res.status(400).send("No `accessToken` provided. ");
        return;
    }
    // password length leak?
    let user = config.users.find(user => (user.accessToken && user.accessToken.length == accessToken && crypto.timingSafeEqual(Buffer.from(user.accessToken), Buffer.from(accessToken))) || (user.password && accessToken.length == user.password.length && crypto.timingSafeEqual(Buffer.from(user.password), Buffer.from(accessToken))));
    if(!user){
        res.status(401).send("Invalid `accessToken` provided. ");
        return;
    }else{
        res.json({
            jwt: jwt.sign({
                    id: user.id,
                    name: user.name, // not all users have this
                    server: "stargate",
                    timestamp: Date.now()
            },config.secret, {
                algorithm: "HS256",
                expiresIn: config.sessionMaxLength
            }),
            ok: true
        });
    }
});

router.get("/apps", (req, res) => {
    res.json({
        ok: true,
        data: config.appSpecs
    });
});

router.get("/app/:id", (req, res) => {
    // console.log(config.appSpecs, " ",req.params.id);
    let appSpec = config.appSpecs.find(appSpec => appSpec.id === req.params.id);
    if(!appSpec){
        res.status(404).send("App not found. ");
        return;
    }
    res.json({
        ok: true,
        data: appSpec
    });
});

router.get("/jwt", (req, res) => res.json(req.auth));


// Session Management
let userSessions = new Map();

m.on("deleteSession", (id) => {
    logger.info("Deleting session of id "  + id);
    let toDelete = [];
    for(let pair of userSessions.entries()){
        if(pair[1] == id){
            toDelete.push(pair[0]);
        }
    }
    for(let uid of toDelete){
        userSessions.delete(uid);
    }
})

function getSessionFor(uid){
    return m.getSession(userSessions.get(uid));
}

function getUser(req){
    let user = config.users.find(user => user.id == req.auth.id);
    if(!user) return null;
    return user;
}

function getUidOf(req){
    let id = getUser(req).id;
    return id;
}

router.post("/session", async (req, res) => {
    // for simulating lag in development
    // await sleep(1000);
    let uid = getUidOf(req);
    let user = getUser(req);
    if(!uid){
        res.status(403).send("Invalid user. ");
        return;
    }
    if(!req.body || !req.body.app) return res.status(400).send("No app specified. ");
    let appSpec = config.appSpecs.find(appSpec => appSpec.id === req.body.app);
    if(!appSpec){
        res.status(404).send("App not found. ");
        return;
    }
    if(!user.canStartSession){
        res.status(403).send("User cannot start sessions. ");
        return;
    }
    if(userSessions.get(user.id)){
        res.status(409).json({
            ok: false,
            message: "User already has another session",
            currentSessionID: userSessions.get(user.id),
            data: userSessions.get(user.id)
        });
        return;
    }
    userSessions.set(user.id, {placeholder: true});
    let sid = await m.launch(user, appSpec, {});
    userSessions.set(user.id, sid);
    res.json({
        ok: true,
        sessionID: sid,
        data: sid
    });
});

router.post("/session/secret/check", async (req, res) => {
    if(req.body.sid){
        let session = m.getSession(req.body.sid);
        if(session.secret != req.body.secret){
            res.status(403).send("Invalid secret. ");
            return;
        }
        res.json({
            ok: true
        });
    }else{
        res.status(400).send("No `sid` provided in POST body. ");
        return;
    }
});

router.get("/session/:id", (req, res) => {
    let uid = getUidOf(req);
    if(!uid){
        res.status(403).send("Invalid user. ");
        return;
    }
    console.log("Lookup",req.params.id);
    let session = m.getSession(req.params.id);
    if(!session){
        res.status(404).send("Session not found. ");
        return;
    }
    res.json({
        ok: true,
        data: session.serialize()
    });
});


router.delete("/session", async (req,res) => {
    let uid = getUidOf(req);
    if(!uid){
        res.status(403).send("Invalid user. ");
        return;
    }
    if(!userSessions.get(uid)){
        res.status(404).send("User has no session. ");
        return;
    }
    await getSessionFor(uid).requestStop();
    res.json({
        ok: true
    });
});

app.use("/api/v1",auth,router);

// fallback to serving static if no routes are hit
app.use(express.static("user_static"));
app.use(express.static("static"));

// our socket.io security mostly relies on people not leaking session ids for guest support. 
let sockIDMap = new Map();
io.on("connection", (socket) => {
    logger.info("New socket connection with id " + socket.id);
    sockIDMap.set(socket.id, {
        uid: null,
        sid: null,
        privs: 0
    });
    socket.emit("hello", config.streamerdTargetHttpAddr, config.debug ? true: false);
    socket.on("jwt", (token) => {
        try{
            if(jwt.verify(token,config.secret)){
                let decoded = jwt.decode(token);
                if(decoded.server == "stargate"){
                    let socketObj = sockIDMap.get(socket.id);
                    socketObj.uid = decoded.id;
                    sockIDMap.set(socket.id, socketObj);
                    logger.info("User " + decoded.id + " authenticated with socket id " + socket.id);
                }
            }
        }catch(ex){
            console.log("Invalid token",token);
            socket.emit("invalidToken", true);
            socket.disconnect();
        }
    });

    socket.on("join_session", (sid) => {
        let socketObj = sockIDMap.get(socket.id);
        if(socketObj.sid){
            // already in a session
            socket.emit("error", "Already in a session. Cannot join another session on the same socket.");
            socket.emit("errorType", "sessionConflict");
            socket.emit("sessionConflict", true)
            return;
        }
        if(m.getSession(sid)){
            socketObj.privs = 1;
            socketObj.sid = sid;
        }else{
            socket.emit("error", "Session not found. ");
            socket.emit("errorType", "sessionNotFound");
            socket.emit("sessionNotFound", true);
        }
        sockIDMap.set(socket.id, socketObj);
    });

    socket.on("upgrade_privs", (secret) => {
        let socketObj = sockIDMap.get(socket.id);
        let session = m.findBySecret(secret);
        logger.info("Upgrading privs of socket " + socket.id + " to " + session.sid);
        if(session){
            socketObj.privs = 2;
            socketObj.sid = session.sid;
            socketObj.uid = null;
            // this exists to make it easier to write the rust portion
            session.setState(SESSION_STATE.Handshaking);
            socket.emit("upgraded", true);
            socket.emit("session_id", session.sid);
        }
        sockIDMap.set(socket.id, socketObj);
        cb();
    });

    socket.on("set_session_state", (state) => {
        let socketObj = sockIDMap.get(socket.id);
        if(socketObj.sid && socketObj.privs >= 2){
            m.getSession(socketObj.sid).setState(state);
        }
    });

    socket.on("join_channel", (...channels) => {
        logger.info(socket.id + " joined channels " + channels.join(", "));
        channels.forEach(channel => socket.join(channel));
    });

    socket.on("leave_channel", (...channels) => {
        channels.forEach(channel => socket.leave(channel));
    }); 

    socket.on("close", (code) => {
        logger.info("Socket " + socket.id + " closed with code " + code);
        sockIDMap.delete(socket.id);
    });
});

m.on("launchSession", (sid) => {
    let session = m.getSession(sid);
    if(session instanceof LocalApplication){
        // js "casting"
        /** @type {LocalApplication} */
        let localApp = session;
        let streams = localApp.getStreams();
        for(let pair of Object.entries(streams)){
            let [id, stream] = pair;
            console.log("Piping app's ",id, " of ",sid, " session id to socket");
            stream.on("data", (data) => {
                io.to(sid + ":" + id).emit(sid + ":" + id, data);
            });
        }
    }
});

const port = config.port || 8001;

/*app.listen(port, () => {
    logger.info("Server is listening on port " + port);
});*/

server.listen(port, () => {
    console.log('listening on 127.0.0.1:' + port + " and maybe more hosts. ");
});