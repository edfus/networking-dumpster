FROM alpine:3
COPY ./socks5-test /app/socks5-test
RUN chmod +x /app/socks5-test
ENTRYPOINT ["/app/socks5-test"]
