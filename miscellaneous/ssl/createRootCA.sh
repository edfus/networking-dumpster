#! /bin/bash
winpty openssl genrsa -des3 -out ./out.hidden/rootCA.key 2048
winpty openssl req -x509 -new -nodes -key ./out.hidden/rootCA.key -sha256 -days 1024 -out ./out.hidden/rootCA.pem
read -p "Done."