const map = new Map();

const entries =
[
  "/ps", "/Adobe+Photoshop+2020+SP.7z",
  "/adobe", "/AdobeCreativeCloudCleanerTool.exe"
];

for (let i = 0; i < entries.length; i += 2) {
  map.set(
    format(entries[i]),
    format(entries[i + 1])
  );
}

export default map;

function format (path) {
  if(!path.startsWith("/")) {
    return "/".concat(path);
  }
  return path;
}