import { spawn } from "child_process";
import { promises as fsp } from "fs";

const args = process.argv.slice(2, process.argv.length);

const initialsToRun = args[0].trim().toLowerCase();

const children = [];

fsp.readdir("./", { withFileTypes: true })
  .then(
    dirents => dirents.some(dirent => {
      if(dirent.isFile() && /\.m?js$/.test(dirent.name)) {
        const nameInLowerCase = dirent.name.toLowerCase();
        const initials = nameInLowerCase.split(".")[0].split(
          /-|_|\s/
        ).map(s => {
          if(!s) return "";
          const isLetter = /\w/g
          for (let i = 0; i < s.length; i++) {
            if(isLetter.test(s[i])) {
              return s[i];
            }
          }
          return "";
        }).join("");
        
        if(
          initials.startsWith(initialsToRun)
          || nameInLowerCase.startsWith(initialsToRun)
        ) {
          console.info("Executing: ".concat(dirent.name).concat("\n"));

          children.push(
            new Promise((resolve, reject) => {
              const child = spawn (
                `node`,
                [`./${dirent.name}`].concat(args.slice(1, args.length)),
                { shell: true, stdio: "inherit" }
              );

              child.once('exit', resolve);
              child.once('close', resolve);
              child.once("error", reject)
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
