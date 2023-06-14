export class ApplicationInstance {
    

    user;
    appSpecs;
    sid;

    /**
     * The manager that created this instance
     * @type {Manager}
     * @memberof ApplicationInstance
     */
    manager;

    /**
     * Creates an instance of ApplicationInstance.
     * @param {import("./types").User} user User data
     * @param {import("./types").AppSpec} appSpecs Application specifacation
     * @param {string} sid Session id
     * @param {Manager} parentManager The manager that created this instance
     * @memberof ApplicationInstance
     */
    constructor(user, appSpecs, sid, parentManager){
        this.user = user;
        this.appSpecs = appSpecs;
        this.sid = sid;
        this.manager = parentManager;
    }

    start(){
        
    }
    
    stop(){
        this.manager.deleteSession(this.sid);
    }
}

export class Manager {

    instMap = new Map();
    sessionMap = new Map();

    constructor(){

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
    async launch(user, appSpecs, sessionData = {}){
        let sid = this.generateSessionID();
        // to be called by subclass for actual launching
        this.sessionMap.set(sid, {
            user,
            appSpecs,
            ...sessionData
        });
        return sid;
    }

    getSession(id){
        return this.sessionMap.get(id);
    }

    /**
     *
     * @param {string} id
     * @memberof Manager
     */
    deleteSession(id){
        this.sessionMap.delete(id);
        this.instMap.delete(id); // instance calls this when it dies
    }
}