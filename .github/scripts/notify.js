const https = require("https");
const { Writable } = require("stream");
const { pipeline } = require("stream/promises");
const { Auth } = require("./auth-client.js");
const { JSONParser } = require("./helpers.js");

/**
 * Get Workflow URL responsible for the Action run.
 * @param {*} inputs 
 * @returns 
 */
 async function getWorkflowUrl(token, repo, workflowName) {
  const req = https.get(
    `https://api.github.com/repos/${repo}/actions/workflows`,
    {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `token ${token}`,
        "User-Agent": `node ${process.version}`
      }
    }
  );

  req.end();

  return new Promise((resolve, reject) => {
    req.once("error", reject);
    req.once("response", async res => {
      if(res.statusCode !== 200) {
        return reject(
          new Error(`getWorkflowUrl errored: ${res.statusCode} ${res.statusMessage}`)
        );
      }

      try {
        await pipeline(
          res,
          new JSONParser(),
          new Writable({
            objectMode: true,
            write({ workflows }, enc, cb) {
              for (const workflow of Object.values(workflows)) {
                if(workflow.name === workflowName) {
                  return cb(resolve(workflow["html_url"] || ""));
                }
              }
              return cb(
                new Error(
                  `getWorkflowUrl: ${workflowName} not found in: ${
                    JSON.stringify(workflows, null, 4)
                  }`
                )
              );
            }
          })
        );
      } catch (err) {
        return reject(err);
      }
    });
  });
}

async function constructMessage(inputs) {
  const getenv = name => process.env[name];

  // derived from workflow environment
  const workflow   = getenv("GITHUB_WORKFLOW");
  const repo       = getenv("GITHUB_REPOSITORY");
  const branch     = getenv("GITHUB_REF");
  const commitSHA  = getenv("GITHUB_SHA").slice(0, 7);
  const runID      = getenv("GITHUB_RUN_ID");

  // derived from action inputs
  const jobStatus  = inputs["jobStatus"];
  const title      = inputs["notificationTitle"];
  const token      = inputs["token"];

  // self constructed
  const commitURL  = `https://github.com/${repo}/commit/${commitSHA}`;
  const repoURL    = `https://github.com/${repo}`;
  const runURL     = `https://github.com/${repo}/actions/runs/${runID}`;

  const workflowURL = await getWorkflowUrl(token, repo, workflow).catch(
    err => {
      console.error(err);
      return "";
    }
  );

  const indent = " ".repeat(2);

  const message = [
    `[github action]`,
    `Action ${title} ${jobStatus}`,
    `${indent}workflow: ${workflow}`,
    `${indent}repository: ${repo.split("/")[1] || repo}`,
    `${indent}branch: ${branch}`,
    // workflowURL,
    runURL
  ];

  return message.join("\r\n");
}

async function notify(url, key, secret) {
  const auth = new Auth({ key, secret });
  const uriObject = new URL(url);

  const req = https.request(uriObject, {
    headers: auth.request(uriObject, "PUT"),
    method: "PUT"
  });

  const getenv = name => process.env[name];
  const message = await constructMessage({
    "jobStatus": getenv("INPUT_STATUS"),
    "token": getenv("INPUT_TOKEN"),
    "notificationTitle": getenv("INPUT_NOTIFICATION_TITLE")
  });

  req.end(message);

  return new Promise((resolve, reject) => {
    req.once("error", reject);
    req.once("response", res => {
      res.resume();
      if (![200, 204].includes(res.statusCode)) {
        return reject(
          new Error(`Accessing ${url} errored: ${res.statusCode} ${res.statusMessage}`)
        );
      }

      return resolve();
    });
  });
}

module.exports = notify;