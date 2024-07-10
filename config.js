import * as TOML from '@ltd/j-toml';
import * as logger from "./logger.js";
import _ from "lodash";
import {defaultAppSpec,defaultUser} from "./defaults.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";

// synchronous config load
export let config = {
    appSpecs: [],
    users: process.env.TEST ? [{
        id: "test",
        password: "1234"       
    }]:[],
    secret: Buffer.from(crypto.getRandomValues(new Uint8Array(32)).buffer).toString("base64"),
    managementOptions: {
        pipewire: true && !process.env.PULSEAUDIO,
        hyperwarpPath: "/opt/hyperwarp",
        streamerPath: "/opt/streamerd",
        hyperwarpTarget: "release",
        procExitRequestTimeoutMs: 30 * 1000
    },
    sessionMaxLength: process.env.NODE_ENV == "production" ? "1d" : "7d", // new development default, will change my life
    debug: false,
    memoryDebug: false,
    flameGraph: false,
    valgrind: false,
    valgrindChild: false,
    port: 8001,
    streamerdTargetHttpAddr: null,
    encoder: "H264",
    optimizations: "None",
    resetLibva: false,
};

export function loadConfig(){
    if(!fs.existsSync('config.toml')){
        logger.warn("No config.toml found, generating a new one. ");
        fs.writeFileSync('config.toml', TOML.stringify(config, {
            newline: os.EOL
        }));
    }
    let configStr = fs.readFileSync('config.toml', 'utf8');

    let configDeserialized = TOML.parse(configStr, {
        joiner: "\n",
        multilineStringJoiner: "\n"
    });
    if(configDeserialized.appSpecs && configDeserialized.appSpecs.length > 0){
        config.appSpecs = configDeserialized.appSpecs.map(appSpec => {
            return _.defaultsDeep(appSpec, defaultAppSpec);
        });
    }else{
        logger.warn("No appSpecs found in config.toml, server won't be able to do much. Consider checking the docs and adding an app. ");
    }

    if(process.env.SECRET){
        config.secret = process.env.SECRET;
    }else if(configDeserialized.secret){
        config.secret = configDeserialized.secret;
    }else{
        logger.warn("No secret found in config.toml or in environment variables, generating a new one. This will invalidate all existing sessions every server restart. Consider specifying a secret in config.toml or in environment variables.");
    }

    if("debug" in configDeserialized) config.debug = configDeserialized.debug; 

    if(configDeserialized.users && configDeserialized.users.length > 0){
        config.users = configDeserialized.users.filter((user, index) => {
            if(!user.id){
                logger.warn("No user id specified for user at index " + index + ", skipping. ");
                return false;
            }
            if(!user.password && !user.passwordHash){
                logger.warn("No user password or password hash specified for user at index " + index + ", skipping. ");
                return false;
            }
            return true;
        }).map(user => {
            return _.defaults(user, defaultUser);
        });
    }else{
        logger.warn("Config specifies no users. ");
    }

    config.managementOptions = (configDeserialized.managementOptions || config.managementOptions); 

    if(configDeserialized.streamerdTargetHttpAddr) config.streamerdTargetHttpAddr = configDeserialized.streamerdTargetHttpAddr;

    // TODO: create our own section in the toml for configuring streamerd
    if(!config.streamerdTargetHttpAddr){
        // make a guess if this is not specified
        config.streamerdTargetHttpAddr = "http://127.0.0.1:" + config.port;
    }

   
    if(configDeserialized.encoder) config.encoder = configDeserialized.encoder;
    if(configDeserialized.optimizations) config.optimizations = configDeserialized.optimizations;
    if("memoryDebug" in configDeserialized) config.memoryDebug = configDeserialized.memoryDebug;
    if("flameGraph" in configDeserialized) config.flameGraph = configDeserialized.flameGraph;
    if("valgrind" in configDeserialized) config.valgrind = configDeserialized.valgrind;
    // allows reseting liva driver name
    if("resetLibva" in configDeserialized) config.resetLibva = configDeserialized.resetLibva;
    if("valgrindChild" in configDeserialized) config.valgrindChild = configDeserialized.valgrindChild;

    // console.log(config.managementOptions);
}

loadConfig();

export default config;