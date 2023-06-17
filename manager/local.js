import {Manager, ApplicationInstance} from "./manager.js";

import fs from "fs";
import path from "path";

import {mkdirp} from "mkdirp";
import config from "../config.js";
import { execAsync, existsAsync } from "../utils.js";

import * as logger from "../logger.js";

import child_process from "child_process";

const AUDIO_SUPPORT = !config.managementOptions.disableAudioSupport;
const HYPERWARP_PATH = process.env.HYPERWARP_PATH || config.managementOptions.hyperwarpPath || "/opt/hyperwarp";
const HYPERWARP_TARGET = process.env.HYPERWARP_TARGET || config.managementOptions.hyperwarpTarget || "release";

// we use null sinks, to recieve and capture audio. 
class AudioManager { // compatible with pipewire ofc
    async cleanup(){
        await execAsync("pactl", ["unload-module", "module-null-sink"]);
    }

    async allocate(id){
        await execAsync("pactl", ["load-module", "module-null-sink", `sink_name=${id}`]);
        // await execAsync("pactl", ["load-module", "module-loopback", `source=${id}.monitor`, `sink=${id}`]);
    }

    async getMonitorOf(id){
        // do we need this yet?

    }
}

export let audio = new AudioManager();

// we assume one user runs one app at a time, so their user id is used as a key
export class LocalApplication extends ApplicationInstance {
    constructor(user, appSpecs, sid, parentManager){
        super(user, appSpecs, sid, parentManager);
    }

    persistenceDir = path.join(process.env.HOME, ".stargate", "userdata");
    sessionDataDir;

    proc;

    /**
     *
     * @param {string[]} args
     * @memberof LocalApplication
     */
    processArgs(args){
        return args.map(arg => {
            if(arg == "%sid%") return this.sid;
            if(arg == "%user%") return this.user.id;
            if(arg == "%username%") return this.user.username;
            return arg;
        })
    }

    loadConfig(){
        this.persistenceDir = process.env.STARGATE_USERDATA || config.managementOptions || this.persistenceDir;
    }

    audioSinkID;

    async makeDirs(){
        await mkdirp(path.join(this.sessionDataDir, "home"));
        await mkdirp(path.join(this.sessionDataDir, "logfiles"));
    }

    genDataDirsEnv(){
        let env = {};
        env["XDG_RUNTIME_DIR"] = path.join(this.sessionDataDir, "home");
        env["HOME"] = path.join(this.sessionDataDir, "home");
        env["XDG_DATA_DIRS"] = path.join(this.sessionDataDir, "home", ".local", "share");
        return env;
    }

    genHyperwarpEnv(){
        const LD_PRELOAD = [
            path.join(HYPERWARP_PATH, "libhyperpreglue.so"),
            path.join(HYPERWARP_PATH, "target", HYPERWARP_TARGET, "libhyperwarphooker.so"),
            path.join(HYPERWARP_PATH, "libhyperglue.so")
        ].join(":");
        return {
            "HYPERWARP_SESSION_ID": this.sid,
            "HYPERWARP_USER_ID": this.user.id,
            "HYPERWARP_ENABLED": "1",
            "LD_PRELOAD": LD_PRELOAD
        }
    }

    async start(){
        this.loadConfig();
        this.makeDirs();
        this.sessionDataDir = path.join(this.persistenceDir, this.user.id);
        this.audioSinkID = this.user.id;
        
        if(AUDIO_SUPPORT) await audio.allocate(this.audioSinkID);

        let env = {};
        Object.assign(env, process.env);
        if(AUDIO_SUPPORT){
            env["PULSE_SINK"] = this.audioSinkID;
        }

        Object.assign(env, this.appSpecs.env);
        Object.assign(env, this.genDataDirsEnv());
        Object.assign(env, this.genHyperwarpEnv());

        this.proc = child_process.spawn(this.appSpecs.binary, this.processArgs(this.appSpecs.args), {
            stdio: "pipe",
            cwd: this.sessionDataDir,
            env: env
        });

        // exit handler

        this.proc.on("exit", () => {
            this.stop();
        });

        // log pipe

        this.proc.stdout.pipe(fs.createWriteStream(path.join(this.sessionDataDir, "logfiles", this.sid + "-stdout.log")));
        this.proc.stderr.pipe(fs.createWriteStream(path.join(this.sessionDataDir, "logfiles", this.sid + "-stderr.log")));
    }

    getStreams(){
        if(this.proc){
            return {
                stdout: this.proc.stdout,
                stderr: this.proc.stderr
            }
        }
        return {};
    }

    async stop(){
        await super.stop(); // remove from manager
        this.proc = null;
    }

    async requestStop(){
        await super.requestStop();
        if(!this.proc){
            return;
        }
        this.proc.kill();
        setTimeout(() => {
            logger.warn("Process did not exit within timeout, killing with SIGKILL. ");
            if(this.proc){
                this.proc.kill("SIGKILL");
            }
        }, config.managementOptions.procExitRequestTimeoutMs || (30 * 1000));
    }
}

export class LocalManager extends Manager {
    constructor(){
        super();
    }

    async start(){
        if(!config.managementOptions.disableStartupAudioCleanup) await audio.cleanup();
        let ok = true;
        if(!(await existsAsync(path.join(HYPERWARP_PATH, "target", HYPERWARP_TARGET, "libhyperwarphooker.so")))){
            logger.warn("Hyperwarp hook is not found, please build it first with `make`. ");
            ok = false;
        }
        if(!(await existsAsync(path.join(HYPERWARP_PATH, "libhyperglue.so")))){
            logger.warn("Hyperwarp c post hook is not found, please build it first with `make`. ");
            ok = false;
        }
        if(!(await existsAsync(path.join(HYPERWARP_PATH, "libhyperpreglue.so")))){
            logger.warn("Hyperwarp c pre hook is not found, please build it first with `make`. ");
            ok = false;
        }
        if(ok){
            logger.success("Hyperwarp hooks found. ");
        }
    }

    proc;

     /**
     * Creates an instance of ApplicationInstance.
     * @param {import("./types").User} user User data
     * @param {import("./types").AppSpec} appSpecs Application specifacation
     * @memberof Manager
     */
    async launch(user, appSpecs, sessionData = {}){
        let sid = await super.launch(user, appSpecs, sessionData);
        let app = new LocalApplication(user, appSpecs, sid, this);
        this.instMap.set(sid, app);
        await app.start();
        return sid;
    }
}

export default LocalManager;