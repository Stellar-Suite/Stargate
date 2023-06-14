import {Manager, ApplicationInstance} from "./manager.js";

import path from "path";

import mkdirp from "mkdirp";
import config from "../config.js";
import { execAsync } from "../utils.js";

import child_process from "child_process";

// we use null sinks, to recieve and capture audio. 
class AudioManager { // compatible with pipewire ofc
    async cleanup(){
        await execAsync("pactl", ["unload-module", "module-null-sink"]);
    }

    allocate(){

    }

    getMonitorOf(){

    }
}

export let audio = new AudioManager();

export class LocalApplication extends ApplicationInstance {
    constructor(user, appSpecs, sid, parentManager){
        super(user, appSpecs, sid, parentManager);
    }

    persistenceDir = path.join(process.env.HOME, ".stargate", "userdata");
    sessionDataDir;

    /**
     *
     * @param {string[]} args
     * @memberof LocalApplication
     */
    processArgs(args){

    }

    loadConfig(){
        this.persistenceDir = process.env.STARGATE_USERDATA || config.managementOptions || this.persistenceDir;
    }

    async start(){
        this.loadConfig();
        this.sessionDataDir = path.join(this.persistenceDir, this.user.id);

    }
}

export class LocalManager extends Manager {
    constructor(){
        super();
    }

    async start(){
        if(!config.managementOptions.disableStartupAudioCleanup) await audio.cleanup();
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