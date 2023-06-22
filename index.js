import "dotenv/config";

import express from "express";

import {expressjwt} from "express-jwt";

import * as logger from "./logger.js";

import {config} from "./config.js";

const app = express();

import cors from "cors";

app.use(cors()); // TODO, allow restricting domains. 

import LocalManager from "./manager/local.js";

import crypto from "crypto";

import jwt from "jsonwebtoken";

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
    let appSpec = config.appSpecs.find(appSpec => appSpec.id == req.params.id);
    if(!appSpec){
        res.status(404).send("App not found. ");
    }
    res.json({
        ok: true,
        data: appSpec
    });
});

// Session Management
let userSessions = new Map();

app.use("/api/v1",auth,router);

// fallback to serving static if no routes are hit
app.use("/", express.static("user_static"));
app.use("/", express.static("public"));

app.listen(8001, () => {
    logger.info("Server is listening on port 8001");
});