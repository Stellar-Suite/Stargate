import chalk from 'chalk';

function stringify(args){
    return args.map(arg => {
        if(typeof arg === 'object'){
            return JSON.stringify(arg)
        }
        return arg;
    }).join(' ');
}

export function log(...args){
    console.log(stringify(args));
}

export function info(...args){
    console.log(chalk.blue("Info: ") + stringify(args));
}

export function warn(...args){
    console.log(chalk.yellow("Warning: ") + stringify(args));
}

export function error(...args){
    console.log(chalk.red("Error: ") + stringify(args));
}

export function success(...args){
    console.log(chalk.greenBright("Success: ") + stringify(args));
}