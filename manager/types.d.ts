export interface User {
    id: string;
    appWhitelist?: string;
    admin: false;
    name?: string;
}

export interface AppSpec{
    binary?: string; // maybe apps don't need to be locally installed
    id?: string; 
    rewriteHome?: boolean;
    rewriteData?: boolean;
    args?: string[];
    env?: {[key: string]: string};
}