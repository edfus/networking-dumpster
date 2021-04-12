#!/bin/bash
# export MSYS_NO_PATHCONV=1
set -e
winpty openssl genrsa -des3 -out ./out.hidden/rootCA.key 2048
winpty openssl req -x509 -new -nodes \
-key ./out.hidden/rootCA.key -sha256 \
-subj "//X=1/C=US/ST=Here/L=LAN/O=Self Signed localhost CA" \
-addext "extendedKeyUsage = serverAuth" \
-days 1024 -out ./out.hidden/rootCA.crt 
read -p "Done."