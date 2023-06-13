export interface User {
    id: string;
    appWhitelist?: string;
    admin: false;
}

export interface AppSpec{
    binary?: string; // maybe apps don't need to be locally installed
    id?: string; 
    rewriteHome?: boolean;
    rewriteData?: boolean;
}