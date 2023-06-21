export const defaultAppSpec = {
    rewriteHome: true,
    rewriteDataDirs: true,
    poster: "/assets/poster_placeholder.png",
    displayName: "Untitled App",
    description: "No description provided. ",
    args: []
}

export const defaultUser = {
    admin: false,
    canStartSession: true,
    canListApps: true, // TODO: make this work
    name: "Nameless User",
};