import { spawn } from "child_process";
import { promises as fsp } from "fs";

const args = process.argv.slice(2, process.argv.length);

const acronymToRun = args[0];

const children = [];

fsp.readdir("./", { withFileTypes: true })
  .then(
    dirents => dirents.some(dirent => {
      if(dirent.isFile() && /\.m?js$/.test(dirent.name)) {
        if(dirent.name.startsWith(acronymToRun)) {
          console.info("Executing: ".concat(dirent.name).concat("\n"));

          children.push(
            new Promise((resolve, reject) => {
              const child = spawn (
                `node`,
                [`./${dirent.name}`].concat(args.slice(1, args.length))
              );
              process.stdin.pipe(child.stdin);
              child.stdout.pipe(process.stdout);
              child.stderr.pipe(process.stderr);

              child.on('exit', resolve);
              child.on('close', resolve);
              child.on("error", reject)
            })   
          )
          return true;
        }
      }
      return false;
    })
  )
  .then(hit => {
    !hit && console.warn("Not Found: ".concat(args[0]));
  });
