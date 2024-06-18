import crypto from "crypto";
import {EventEmitter} from "events";
import {nanoid} from "nanoid"

export class ApplicationInstance extends EventEmitter {
    

    user;
    appSpecs;
    sid;

    secret;

    /**
     * The manager that created this instance
     * @type {Manager}
     * @memberof ApplicationInstance
     */
    manager;

    ready = false;

    /**
     * Creates an instance of ApplicationInstance.
     * @param {import("./types").User} user User data
     * @param {import("./types").AppSpec} appSpecs Application specifacation
     * @param {string} sid Session id
     * @param {Manager} parentManager The manager that created this instance
     * @memberof ApplicationInstance
     */
    constructor(user, appSpecs, sid, parentManager){
        super();
        this.user = user;
        this.appSpecs = appSpecs;
        this.sid = sid;
        this.manager = parentManager;
        this.secret = nanoid(64);
    }

    async _start(){
         
    }

    async start(){
        this.emit("prestart");
        await this._start();
        this.emit("start");
    }
    
    async _stop(){
        this.manager.deleteSession(this.sid);
    }

    async stop(){
        this.emit("prestop");
        await this._stop();
        this.emit("stop");
    }

    async requestStop(){
        // TODO: event emitters and internal impl?
    }

    serialize(){
        return {
            admin:{
                id: this.user.id,
                name: this.user.name,
            },
            appSpecs: this.appSpecs,
            sid: this.sid,
            ready: this.ready
        }
    }
}

export class Manager extends EventEmitter {

    instMap = new Map();
    sessionMap = new Map();

    constructor(){
        super();
    }

    async start(){

    }

    generateSessionID(){
        // we rely on this to be unpreidctable
        return crypto.randomUUID();
    }

    /**
     * Creates an instance of ApplicationInstance.
     * @param {import("./types").User} user User data
     * @param {import("./types").AppSpec} appSpecs Application specifacation
     * @memberof Manager
     */
    async _launch(user, appSpecs, sessionData = {}){
        let sid = this.generateSessionID();
        // to be called by subclass for actual launching
        this.sessionMap.set(sid, {
            user,
            appSpecs,
            ...sessionData
        });
        return sid;
    }

    /**
     * Creates an instance of ApplicationInstance.
     * @param {import("./types").User} user User data
     * @param {import("./types").AppSpec} appSpecs Application specifacation
     * @memberof Manager
     */
    async launch(){
        this.emit("prelaunchSession");
        let result = await this._launch(...arguments);
        // console.log("launchSession",result);
        this.emit("launchSession", result);
        return result;
    }

    /**
     *
     * @param {string} id
     * @return {ApplicationInstance} 
     * @memberof Manager
     */
    getSession(id){
        return this.instMap.get(id) || this.sessionMap.get(id);
    }

    findSession(func){
        return this.sessionMap.values().find(func);
    }

    findBySecret(secret){
        return this.sessionMap.values().find(session => session.secret == secret);
    }

    /**
     *
     * @param {string} id
     * @memberof Manager
     */
    deleteSession(id){
        this.sessionMap.delete(id);
        this.instMap.delete(id); // instance calls this when it dies
        this.emit("deleteSession", id);
    }
}