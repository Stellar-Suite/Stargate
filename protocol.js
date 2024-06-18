// translated protocol.rs from Hyperwarp
/*
#[derive(Serialize_repr, Deserialize_repr, PartialEq, Debug)]
#[repr(u8)]
enum SessionState {
    Initalizing = 0,
    Handshaking = 1,
    Ready = 2,
    Disconnecting = 9,
}
*/

export const SESSION_STATE = {
    "Initalizing": 0,
    "Handshaking": 1,
    "Ready": 2,
    "Disconnecting": 9,
};

export const SESSION_STATE_BY_NUMBER = {
    0: "Initalizing",
    1: "Handshaking",
    2: "Ready",
    9: "Disconnecting",
};
