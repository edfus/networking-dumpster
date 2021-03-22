function decode (JWT) {
  const { 0: header, 1: body, 2: signature } = JWT.split(".");
  
  
}

function base64urlDecode (data) {
  return atob(
    data.replace(/_/g, '/').replace(/-/g, '+')
  );
}

function base64urlEncode (data) {
  return btoa(
    data.replace(/\//g, '_').replace(/\+/g, '-')
  );
}