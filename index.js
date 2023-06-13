import express from "express";

import * as logger from "./logger.js";

import * as dotenv from "dotenv";

import {config} from "./config.js";

dotenv.config();

const app = express();

// fallback to serving static if no routes are hit
app.use("/", express.static("public"));

app.listen(3000, () => {
    logger.info("Server is listening on port 3000");
});