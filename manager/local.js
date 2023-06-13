import {Manager, ApplicationInstance} from "./manager.js";

import path from "path";

import mkdirp from "mkdirp";
import config from "../config.js";
import { execAsync } from "../utils.js";

export class LocalManager extends Manager {
    constructor(){
        super();
    }
}

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

    loadConfig(){
        this.persistenceDir = process.env.STARGATE_USERDATA || config.managementOptions || this.persistenceDir;
    }

    start(){
        this.loadConfig();
        this.sessionDataDir = path.join(this.persistenceDir, this.user.id);

    }
}



export default LocalManager;