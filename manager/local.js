import {Manager, ApplicationInstance} from "./manager.js";

import fs from "fs";
import path from "path";
import crypto from "crypto";

import {mkdirp} from "mkdirp";
import config from "../config.js";
import { execAsync, existsAsync } from "../utils.js";

import * as logger from "../logger.js";

import child_process from "child_process";

const AUDIO_SUPPORT = !config.managementOptions.disableAudioSupport;
const HYPERWARP_PATH = process.env.HYPERWARP_PATH || config.managementOptions.hyperwarpPath || "/opt/hyperwarp";
const HYPERWARP_TARGET = process.env.HYPERWARP_TARGET || config.managementOptions.hyperwarpTarget || "debug";
const STREAMERD_PATH = process.env.STREAMERD_PATH || config.managementOptions.streamerPath || "/opt/streamerd";

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

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
        this.persistenceDir = process.env.STARGATE_USERDATA || config.managementOptions.persistenceDir || this.persistenceDir;
    }

    audioSinkID;

    async makeDirs(){
        await mkdirp(path.join(this.sessionDataDir, "home"));
        await mkdirp(path.join(this.sessionDataDir, "logfiles"));
        await mkdirp("/tmp/hyperwarp");
    }

    genDataDirsEnv(){
        let env = {};
        // env["XDG_RUNTIME_DIR"] = path.join(this.sessionDataDir, "home");
        if(this.appSpecs.rewriteHome) env["HOME"] = path.join(this.sessionDataDir, "home");
        if(this.appSpecs.rewriteData) env["XDG_DATA_DIRS"] = path.join(this.sessionDataDir, "home", ".local", "share");
        return env;
    }

    getSocketPath(){
        return path.join("/tmp/hyperwarp", `hw-${this.sid}.sock`);   
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
            // effective params
            "HW_SOCKET_PATH": this.getSocketPath(),
            "HW_SESSION_ID": this.sid,
            "HW_USER_ID": this.user.id,
            "HYPERWARP_ENABLED": "1",
            "LD_PRELOAD": LD_PRELOAD,
            "CAPTURE_MODE": "1",
            "DEBUG_HW": config.debug ? "1" : "0",
            "SDL_AUDIODRIVER": "pulseaudio",
            "RETITLE_WINDOWS": "1"
        }
    }

    async _start(){
        this.loadConfig();
        this.sessionDataDir = path.join(this.persistenceDir, this.user.id);
        this.makeDirs();
        this.audioSinkID = this.user.id;
        
        if(AUDIO_SUPPORT) await audio.allocate(this.audioSinkID);

        let env = {};
        Object.assign(env, process.env);
        if(AUDIO_SUPPORT){
            env["PULSE_SINK"] = this.audioSinkID;
        }

        let envChanges = {};

        Object.assign(envChanges, this.appSpecs.env);
        Object.assign(envChanges, this.genDataDirsEnv());
        Object.assign(envChanges, this.genHyperwarpEnv());

        Object.assign(env, envChanges);

        let binary = this.appSpecs.binary;
        let args = this.processArgs(this.appSpecs.args);

        if(config.valgrindChild){
            args.unshift(binary);
            for(let pair of Object.entries(envChanges)){
                let [key, value] = pair;
                args.unshift(key + "=" + value);
            }
            args.unshift("env");
            args.unshift("--trace-children=yes");
            args.unshift("--leak-check=full");
            binary = "valgrind";
        }

        if(config.debug){
            console.log("Binary spawn details");
            console.log(binary, args.join(" "));
        }

        this.proc = child_process.spawn(binary, args, {
            stdio: "pipe",
            cwd: this.sessionDataDir,
            env: config.valgrindChild ? process.env : env
        });

        // exit handler

        this.proc.on("exit", () => {
            this.stop();
        });

        // log pipe
        this.proc.stdout.pipe(fs.createWriteStream(path.join(this.sessionDataDir, "logfiles", this.sid + "-stdout.log")));
        this.proc.stderr.pipe(fs.createWriteStream(path.join(this.sessionDataDir, "logfiles", this.sid + "-stderr.log")));

        if(config.debug){
            console.log("Spawned pid", this.proc.pid);
            for(let pair of Object.entries(env)){
                let [key, value] = pair;
                console.log(key + "=" + value);
            }
            this.proc.stdout.pipe(process.stdout);
            this.proc.stderr.pipe(process.stderr);
        }

        // wait for socket to exist
        let tries = 0;
        while(tries < 30){
            if(await existsAsync(this.getSocketPath())){
                break;
            }else{
                logger.info("Socket not found yet on try " + tries);
            }
            await sleep(1000);
        }
        if(tries < 30){
            // launch streamer
            await sleep(1000);
            logger.info("Launching streamerd");
            this.streamer = this.spawnStreamerd();

        }else{
            logger.error("App is not opening communication socket. This may be an issue. We are not starting streamerd yet.")
        }
    }

    spawnStreamerd(){
        let args = [
            "--socket", this.getSocketPath(),
            "--mode", "hyperwarp",
            "--url", config.streamerdTargetHttpAddr
        ];

        if(config.encoder) args.push("--encoder", config.encoder);
        if(config.optimizations) args.push("--optimizations", config.optimizations);

        let binary = STREAMERD_PATH;

        let extra_env = {};
        if(config.memoryDebug){
            // doesn't work?
            logger.info("Memory debugging enabled. Adding extra env vars to streamerd.");
            extra_env["RUST_LOG"] = "debug";
            extra_env["RUST_BACKTRACE"] = "full";
            // work on fedora but may need to change for other distros
            // extra_env["LD_PRELOAD"] = "/usr/lib64/libtcmalloc.so.4";
            // extra_env["HEAPPROFILE"] = "/tmp/heap.prof";
            // for jemalloc
            extra_env["MALLOC_CONF"] = "prof:true,prof_leak:true,lg_prof_sample:19,stats_print:true,prof_prefix:/tmp/jeprof.out";
        }

        if(config.flameGraph){
            // this doesn't work please use the actual flamegraph pid option from somewhere else
            logger.info("Applying flamegraph for profiling");
            binary = "flamegraph";
            args.unshift(STREAMERD_PATH);
            args.unshift("--");
            args.unshift("/tmp/streamerd.svg");
            args.unshift("-o");
        }

        if(config.valgrind){
            logger.info("Applying valgrind for profiling");
            binary = "valgrind";
            args.unshift(STREAMERD_PATH);
            args.unshift("--leak-check=full");
        }

        if(config.debug){
            logger.info("Applying gst debug for profiling");
            extra_env["GST_DEBUG_DUMP_DOT_DIR"] = "/tmp/gst-debug";
        }

        if(config.resetLibva){
            extra_env["LIBVA_DRIVER_NAME"] = "";
        }

        logger.info("cmd: " + binary + " " + args.join(" "));

        let env = {
            ...process.env,
            "HYPERWARP_SESSION_ID": this.sid,
            "HYPERWARP_USER_ID": this.user.id,
            "RUST_BACKTRACE": "1",
            "XDG_RUNTIME_DIR": "/run/user/1000", // fix bug with streamerd
            "STARGATE_SECRET": this.secret,
            "GST_DEBUG": "INFO",
            ...extra_env
        };

        if(config.resetLibva){
            delete env["LIBVA_DRIVER_NAME"];
        }

        let proc = child_process.spawn(binary, args, {
            env: env
        });


        proc.stdout.pipe(fs.createWriteStream(path.join(this.sessionDataDir, "logfiles", this.sid + "-streamer-stdout.log")));
        proc.stderr.pipe(fs.createWriteStream(path.join(this.sessionDataDir, "logfiles", this.sid + "-streamer-stderr.log")));

        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);

        proc.on("exit", (code, signal) => {
            logger.info("Streamerd exited with code " + code + " " + signal + " " + proc.exitCode);
        });

        return proc;
    }

    getStreams(){
        const output = {}
        if(this.proc){
            output.stdout = this.proc.stdout,
            output.stderr = this.proc.stderr
        }
        if(this.streamer){
            output.streamer_stdout = this.streamer.stdout;
            output.streamer_stderr = this.streamer.stderr;
        }
        return output;
    }

    async _stop(){
        console.log("Local app stopped");
        await super._stop(); // remove from manager
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
        if(!config.managementOptions.disableStartupAudioCleanup && AUDIO_SUPPORT) await audio.cleanup();
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
    async _launch(user, appSpecs, sessionData = {}){
        let sid = await super._launch(user, appSpecs, sessionData);
        let app = new LocalApplication(user, appSpecs, sid, this);
        this.instMap.set(sid, app);
        await app.start();
        return sid;
    }
}

export default LocalManager;