#! /bin/bash
openssl req -new -sha256 -nodes -out server.csr -newkey rsa:2048 -keyout cert.key -config ssl.conf

winpty openssl x509 -req -in server.csr -CA ./out/rootCA.pem -CAkey ./out/rootCA.key -CAcreateserial -out cert.pem -days 500 -sha256 -extfile v3.ext
read -p "Done."