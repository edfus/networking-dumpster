#! /bin/bash
mkdir ./out/
winpty openssl genrsa -des3 -out ./out/rootCA.key 2048
winpty openssl req -x509 -new -nodes -key ./out/rootCA.key -sha256 -days 1024 -out ./out/rootCA.pem
read -p "Done."