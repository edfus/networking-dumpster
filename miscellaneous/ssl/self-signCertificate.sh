#! /bin/bash
openssl req -new -sha256 -nodes -out ./out.hidden/server.csr -newkey rsa:2048 -keyout ./out.hidden/server.key -config ssl.conf

winpty openssl x509 -req -in ./out.hidden/server.csr -CA ./out.hidden/rootCA.pem -CAkey ./out.hidden/rootCA.key -CAcreateserial -out ./out.hidden/server.crt -days 500 -sha256 -extfile v3.ext
read -p "Done."